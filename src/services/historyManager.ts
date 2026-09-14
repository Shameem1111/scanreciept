import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getEncryptedJson, setEncryptedJson, removeEncryptedJson, deleteEncryptionKey } from './encryptedStore';
import { clearExportFiles, shareHistoryJson } from './historyExport';
import { exportHistory, hasDuplicate, RECOVERY_MESSAGE, SAVE_ERROR, validateHistory } from './historyData';
import { storageProviders, saveReceiptAsset, plannedLocalReference } from './storage';
import { updateStructuredReceipt } from './receiptUpdate';
import { ReviewDraft } from './receiptReview';
import { ExtractedReceipt, Receipt, ReceiptAsset, StorageProviderId } from '../types';

export const RECEIPTS_KEY = '@receiptmind/receipts/encrypted-v1';
const SETTINGS_KEY = '@receiptmind/settings/v1';
const RESET_KEY = '@receiptmind/reset-pending/v1';
const PENDING_KEY = '@receiptmind/original-pending/v1';
export type HistoryState = { receipts: Receipt[]; storageProvider: StorageProviderId; hydrated: boolean; recovery: string | null };

export class HistoryManager {
  state: HistoryState = { receipts: [], storageProvider: 'local', hydrated: false, recovery: null };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private publish: (state: HistoryState) => void) {}
  private update(change: Partial<HistoryState>) { this.state = { ...this.state, ...change }; this.publish(this.state); }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private ready() { if (!this.state.hydrated || this.state.recovery) throw new Error(RECOVERY_MESSAGE); }
  private async cleanupPending(receipts: Receipt[]) {
    const reference = await AsyncStorage.getItem(PENDING_KEY);
    if (reference && !receipts.some(r => r.storageProvider === 'local' && r.storageReference === reference)) {
      await storageProviders.local.deleteReceipt!(reference);
    }
    await AsyncStorage.removeItem(PENDING_KEY);
  }
  hydrate = () => this.serial(async () => {
    this.update({ hydrated: false });
    try {
      if (await AsyncStorage.getItem(RESET_KEY)) {
        this.update({ recovery: 'Device deletion was interrupted. Choose Delete everything from this device to finish removing files and the encryption key.' });
        return;
      }
      const saved = await getEncryptedJson<unknown>(RECEIPTS_KEY);
      const receipts = saved === null ? [] : validateHistory(saved);
      await this.cleanupPending(receipts);
      await clearExportFiles();
      const settings = await AsyncStorage.getItem(SETTINGS_KEY);
      const provider = settings ? JSON.parse(settings).storageProvider : 'local';
      this.update({ receipts, storageProvider: ['local', 'google-drive', 'icloud'].includes(provider) ? provider : 'local', recovery: null });
    } catch { this.update({ recovery: RECOVERY_MESSAGE }); }
    finally { this.update({ hydrated: true }); }
  });
  private async persist(next: Receipt[]) {
    try { await setEncryptedJson(RECEIPTS_KEY, next); }
    catch { throw new Error(SAVE_ERROR); }
    this.update({ receipts: next });
  }
  addReceipt = (receipt: Receipt) => this.serial(async () => {
    this.ready();
    const clean = validateHistory([receipt])[0]!;
    if (this.state.receipts.some(r => r.id === clean.id)) throw new Error('Receipt already exists.');
    await this.persist([clean, ...this.state.receipts]);
  });
  saveReceipt = (data: ExtractedReceipt, asset: ReceiptAsset, allowDuplicate = false) => this.serial(async () => {
    this.ready();
    if (!allowDuplicate && hasDuplicate(this.state.receipts, data)) throw new Error('Possible duplicate. Review the existing receipt or choose Save anyway.');
    const id = `receipt-${randomUUID()}`;
    const provider = this.state.storageProvider;
    const receipt = validateHistory([{ ...data, id, storageProvider: provider, storageReference: 'demo://receipt',
      originalFilename: asset.name, createdAt: new Date().toISOString() }])[0]!;
    if (asset.uri) {
      // Journal before copying: retry cleanup on startup even after process termination.
      if (provider === 'local') await AsyncStorage.setItem(PENDING_KEY, plannedLocalReference(asset, id));
      else if (!storageProviders[provider].deleteReceipt) throw new Error('This provider does not yet support safe save rollback. Choose This device.');
      try {
        const saved = await saveReceiptAsset(provider, asset, id);
        receipt.storageReference = saved.reference;
      } catch {
        try { await this.cleanupPending(this.state.receipts); }
        catch { this.update({ recovery: 'An incomplete original could not be removed. Free storage and retry recovery, or delete everything from this device.' }); }
        throw new Error(SAVE_ERROR);
      }
    }
    try { await this.persist([receipt, ...this.state.receipts]); }
    catch {
      try {
        if (asset.uri && provider !== 'local') await storageProviders[provider].deleteReceipt!(receipt.storageReference);
        await this.cleanupPending(this.state.receipts);
      } catch { this.update({ recovery: 'Save failed and original cleanup is pending. Free storage and retry recovery, or delete everything from this device.' }); }
      throw new Error(SAVE_ERROR);
    }
    // A committed original must never be rolled back due to journal cleanup failure.
    try { await AsyncStorage.removeItem(PENDING_KEY); }
    catch { this.update({ recovery: 'Receipt saved, but cleanup is pending. Retry recovery before saving another receipt.' }); }
  });
  updateReceipt = (id: string, draft: ReviewDraft) => this.serial(async () => {
    this.ready(); await this.persist(updateStructuredReceipt(this.state.receipts, id, draft));
  });
  deleteReceipt = (id: string) => this.serial(async () => {
    this.ready(); await this.persist(this.state.receipts.filter(r => r.id !== id));
  });
  setStorageProvider = (provider: StorageProviderId) => this.serial(async () => {
    this.ready(); await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ storageProvider: provider }));
    this.update({ storageProvider: provider });
  });
  deleteHistory = () => this.serial(async () => {
    if (await AsyncStorage.getItem(RESET_KEY)) throw new Error('Finish Delete everything from this device first.');
    // History-only reset deliberately retains originals even if history cannot be read.
    await AsyncStorage.removeItem(PENDING_KEY);
    await removeEncryptedJson(RECEIPTS_KEY);
    this.update({ receipts: [], recovery: null });
  });
  deleteEverything = () => this.serial(async () => {
    await AsyncStorage.setItem(RESET_KEY, '1');
    this.update({ recovery: 'Device deletion is pending. Retry Delete everything from this device if interrupted.' });
    await storageProviders.local.deleteAll!();
    await clearExportFiles();
    await removeEncryptedJson(RECEIPTS_KEY);
    this.update({ receipts: [] });
    await deleteEncryptionKey();
    await AsyncStorage.removeItem(SETTINGS_KEY);
    await AsyncStorage.removeItem(PENDING_KEY);
    await AsyncStorage.removeItem(RESET_KEY);
    this.update({ receipts: [], storageProvider: 'local', recovery: null });
  });
  exportJson = () => { this.ready(); return exportHistory(this.state.receipts); };
  exportPurchaseHistory = () => this.serial(async () => { await shareHistoryJson(this.exportJson()); });
}
