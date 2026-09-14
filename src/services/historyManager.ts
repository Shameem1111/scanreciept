import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getEncryptedJson, setEncryptedJson, removeEncryptedJson, deleteEncryptionKey } from './encryptedStore';
import { clearExportFiles, shareHistoryJson } from './historyExport';
import { exportHistory, hasDuplicate, RECOVERY_MESSAGE, SAVE_ERROR, validateHistory } from './historyData';
import { storageProviders, saveReceiptAsset, plannedLocalReference } from './storage';
import { updateStructuredReceipt } from './receiptUpdate';
import { StorageError } from './storageErrors';
import { ReviewDraft } from './receiptReview';
import { ExtractedReceipt, Receipt, ReceiptAsset, StorageProviderId } from '../types';

export const RECEIPTS_KEY = '@receiptmind/receipts/encrypted-v1';
const SETTINGS_KEY = '@receiptmind/settings/v1';
const RESET_KEY = '@receiptmind/reset-pending/v1';
const PENDING_KEY = '@receiptmind/original-pending/v1';
export type HistoryState = { receipts: Receipt[]; storageProvider: StorageProviderId; hydrated: boolean; recovery: string | null; storageWarning?: string | null };

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
  private async pendingOriginal(): Promise<{ provider: StorageProviderId; reference: string } | null> {
    const saved = await AsyncStorage.getItem(PENDING_KEY);
    if (!saved) return null;
    if (saved.startsWith('file://')) return { provider: 'local', reference: saved }; // v1 local journal
    const parsed = JSON.parse(saved);
    if (!['local', 'google-drive', 'icloud'].includes(parsed.provider) || typeof parsed.reference !== 'string') throw new Error('Invalid pending original.');
    return parsed;
  }
  private async cleanupPending(receipts: Receipt[]) {
    const pending = await this.pendingOriginal();
    if (pending && !receipts.some(r => r.storageProvider === pending.provider && r.storageReference === pending.reference)) {
      const provider = storageProviders[pending.provider];
      if (!provider.deleteReceipt) throw new StorageError('The selected provider cannot remove an incomplete original.');
      await provider.deleteReceipt(pending.reference);
    }
    await AsyncStorage.removeItem(PENDING_KEY);
    this.update({ storageWarning: null });
  }
  private cleanupFailed(provider: StorageProviderId) {
    if (provider === 'local') this.update({ recovery: 'Save failed and original cleanup is pending. Free storage and retry recovery, or delete everything from this device.' });
    else this.update({ storageWarning: 'An incomplete cloud upload needs cleanup. Connect its original account and retry cleanup. History remains available; new original saves wait for cleanup.' });
  }
  retryStorageCleanup = () => this.serial(async () => { this.ready(); await this.cleanupPending(this.state.receipts); });
  hydrate = () => this.serial(async () => {
    this.update({ hydrated: false });
    try {
      if (await AsyncStorage.getItem(RESET_KEY)) {
        this.update({ recovery: 'Device deletion was interrupted. Choose Delete everything from this device to finish removing files and the encryption key.' });
        return;
      }
      const saved = await getEncryptedJson<unknown>(RECEIPTS_KEY);
      const receipts = saved === null ? [] : validateHistory(saved);
      try { await this.cleanupPending(receipts); }
      catch (error) {
        const pending = await this.pendingOriginal();
        if (!pending || pending.provider === 'local') throw error;
        this.cleanupFailed(pending.provider);
      }
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
    await this.cleanupPending(this.state.receipts);
    if (!allowDuplicate && hasDuplicate(this.state.receipts, data)) throw new Error('Possible duplicate. Review the existing receipt or choose Save anyway.');
    const id = `receipt-${randomUUID()}`;
    const provider = this.state.storageProvider;
    const receipt = validateHistory([{ ...data, id, storageProvider: provider, storageReference: 'demo://receipt',
      originalFilename: asset.name, createdAt: new Date().toISOString() }])[0]!;
    if (asset.uri) {
      const selected = storageProviders[provider];
      if (!selected.deleteReceipt) throw new StorageError('This provider does not yet support safe save rollback. Choose This device.');
      const planned = selected.prepareSave ? await selected.prepareSave(asset, id) : plannedLocalReference(asset, id);
      // Reserve and journal the stable reference before any upload/copy can create a file.
      await AsyncStorage.setItem(PENDING_KEY, provider === 'local' ? planned : JSON.stringify({ provider, reference: planned }));
      receipt.storageReference = planned;
      try {
        const saved = await saveReceiptAsset(provider, asset, id, planned);
        if (saved.reference !== planned || saved.provider !== provider) throw new Error('Provider reference changed.');
      } catch (error) {
        try { await this.cleanupPending(this.state.receipts); }
        catch { this.cleanupFailed(provider); }
        throw error instanceof StorageError ? error : new Error(SAVE_ERROR);
      }
    }
    try { await this.persist([receipt, ...this.state.receipts]); }
    catch {
      try { await this.cleanupPending(this.state.receipts); }
      catch { this.cleanupFailed(provider); }
      throw new Error(SAVE_ERROR);
    }
    // A committed original must never be rolled back due to journal cleanup failure.
    try { await AsyncStorage.removeItem(PENDING_KEY); }
    catch {
      if (provider === 'local') this.update({ recovery: 'Receipt saved, but cleanup is pending. Retry recovery before saving another receipt.' });
      else this.update({ storageWarning: 'Receipt saved, but its cleanup marker could not be cleared. Retry original cleanup in Settings before saving another original.' });
    }
  });
  updateReceipt = (id: string, draft: ReviewDraft) => this.serial(async () => {
    this.ready(); await this.persist(updateStructuredReceipt(this.state.receipts, id, draft));
  });
  deleteReceipt = (id: string) => this.serial(async () => {
    this.ready();
    // A committed file may still have a journal after failed journal removal.
    // Forget that marker before removing its record, so future recovery preserves the original.
    const pending = await this.pendingOriginal();
    if (pending && this.state.receipts.some(r => r.id === id && r.storageProvider === pending.provider && r.storageReference === pending.reference)) {
      await AsyncStorage.removeItem(PENDING_KEY);
      this.update({ storageWarning: null });
    }
    await this.persist(this.state.receipts.filter(r => r.id !== id));
  });
  connectStorage = (provider: StorageProviderId) => this.serial(async () => {
    // Connecting must remain possible to recover a pending cloud upload.
    const selected = storageProviders[provider];
    if (!selected.connect) throw new StorageError('This provider does not support sign-in.');
    await selected.connect();
  });
  disconnectStorage = (provider: StorageProviderId) => this.serial(async () => {
    const selected = storageProviders[provider];
    if (!selected.disconnect) return;
    if (this.state.storageProvider === provider) {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ storageProvider: 'local' }));
      this.update({ storageProvider: 'local' });
    }
    await selected.disconnect();
  });
  setStorageProvider = (provider: StorageProviderId) => this.serial(async () => {
    this.ready();
    if (provider !== 'local' && !await storageProviders[provider].isAvailable()) throw new StorageError('Connect the storage provider in Settings before selecting it. Existing receipts are unchanged.');
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ storageProvider: provider }));
    this.update({ storageProvider: provider });
  });
  deleteHistory = () => this.serial(async () => {
    if (await AsyncStorage.getItem(RESET_KEY)) throw new Error('Finish Delete everything from this device first.');
    // History-only reset deliberately retains originals even if history cannot be read.
    await AsyncStorage.removeItem(PENDING_KEY);
    await removeEncryptedJson(RECEIPTS_KEY);
    this.update({ receipts: [], recovery: null, storageWarning: null });
  });
  deleteEverything = () => this.serial(async () => {
    await AsyncStorage.setItem(RESET_KEY, '1');
    this.update({ recovery: 'Device deletion is pending. Retry Delete everything from this device if interrupted.' });
    for (const provider of Object.values(storageProviders)) await provider.forgetConnection?.();
    await storageProviders.local.deleteAll!();
    await clearExportFiles();
    await removeEncryptedJson(RECEIPTS_KEY);
    this.update({ receipts: [] });
    await deleteEncryptionKey();
    await AsyncStorage.removeItem(SETTINGS_KEY);
    await AsyncStorage.removeItem(PENDING_KEY);
    await AsyncStorage.removeItem(RESET_KEY);
    this.update({ receipts: [], storageProvider: 'local', recovery: null, storageWarning: null });
  });
  exportJson = () => { this.ready(); return exportHistory(this.state.receipts); };
  exportPurchaseHistory = () => this.serial(async () => { await shareHistoryJson(this.exportJson()); });
}
