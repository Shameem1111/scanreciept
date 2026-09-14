import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { startActivityAsync } from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { ReceiptAsset, StorageProviderId } from '../types';
import { googleDriveProvider } from './googleDrive';

export type StorageSaveResult = {
  provider: StorageProviderId;
  reference: string;
};

export interface ReceiptStorageProvider {
  id: StorageProviderId;
  label: string;
  description?: string;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  forgetConnection?(): Promise<void>;
  connectionStatus?(): Promise<string>;
  prepareSave?(asset: ReceiptAsset, receiptId: string): Promise<string>;
  isConfigured(): boolean;
  isAvailable(reference?: string): Promise<boolean>;
  openReceipt(reference: string): Promise<void>;
  save(asset: ReceiptAsset, receiptId: string, preparedReference?: string): Promise<StorageSaveResult>;
  deleteReceipt?(reference: string): Promise<void>;
  deleteAll?(): Promise<void>;
}

const localProvider: ReceiptStorageProvider = {
  id: 'local',
  label: 'This device',
  isConfigured: () => true,
  async deleteReceipt(reference) {
    const file = localFile(reference);
    if (!file) throw new Error('Invalid original receipt reference.');
    if (file.exists) file.delete();
  },
  async deleteAll() {
    const directory = new Directory(Paths.document, 'ReceiptMind', 'Receipts');
    if (directory.exists) directory.delete();
    // Picker/camera imports can leave original copies in this app's cache.
    const cache = new Directory(Paths.cache);
    if (cache.exists) for (const entry of cache.list()) entry.delete();
  },
  async isAvailable(reference) {
    try {
      if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
      return reference === undefined || !!localFile(reference)?.exists;
    } catch { return false; }
  },
  async openReceipt(reference) {
    if (!await this.isAvailable(reference)) throw new Error('Original receipt unavailable');
    const file = localFile(reference)!;
    if (Platform.OS === 'android') {
      await startActivityAsync('android.intent.action.VIEW', {
        data: file.contentUri, flags: 1, type: file.type || receiptMimeType(reference),
      });
    } else {
      if (!await Sharing.isAvailableAsync()) throw new Error('Original receipt unavailable');
      await Sharing.shareAsync(file.uri, { mimeType: file.type || receiptMimeType(reference), dialogTitle: 'View original receipt' });
    }
  },
  async save(asset, receiptId) {
    const directory = new Directory(Paths.document, 'ReceiptMind', 'Receipts');
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });

    const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destination = new File(directory, `${receiptId}-${safeName}`);
    const source = new File(asset.uri);
    try { await source.copy(destination, { overwrite: false }); }
    catch {
      try { if (destination.exists) destination.delete(); }
      catch { throw new Error('Save failed and an incomplete original could not be removed. Use Delete everything from this device in Settings to clean up.'); }
      throw new Error('Could not store the original. Free device storage and try again.');
    }
    return { provider: 'local', reference: destination.uri };
  },
};

function unconfiguredProvider(id: Exclude<StorageProviderId, 'local'>, label: string): ReceiptStorageProvider {
  return {
    id,
    label,
    isConfigured: () => false,
    isAvailable: async () => false,
    async openReceipt() { throw new Error('Original receipt unavailable'); },
    async save() {
      throw new Error(`${label} is not configured in this build yet.`);
    },
  };
}

export const storageProviders: Record<StorageProviderId, ReceiptStorageProvider> = {
  local: localProvider,
  'google-drive': googleDriveProvider,
  icloud: unconfiguredProvider('icloud', 'iCloud Drive'),
};

export function plannedLocalReference(asset: ReceiptAsset, receiptId: string): string {
  const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return new File(new Directory(Paths.document, 'ReceiptMind', 'Receipts'), `${receiptId}-${safeName}`).uri;
}

// Accept only originals inside the app's receipt directory, never arbitrary local files.
// Rebase legacy absolute references when iOS changes the application container path.
function localFile(reference: string): File | null {
  if (!reference.startsWith('file://')) return null;
  const marker = '/ReceiptMind/Receipts/';
  const index = reference.lastIndexOf(marker);
  if (index < 0) return null;
  const name = decodeURIComponent(reference.slice(index + marker.length));
  if (!name || name === '.' || name === '..' || /[\\/\u0000]/.test(name)) return null;
  return new File(new Directory(Paths.document, 'ReceiptMind', 'Receipts'), name);
}

function receiptMimeType(reference: string): string {
  const extension = reference.split('.').pop()?.toLowerCase();
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    heic: 'image/heic', webp: 'image/webp' } as Record<string, string>)[extension ?? ''] ?? 'image/*';
}

type OriginalReference = { storageProvider: StorageProviderId; storageReference: string };

export async function isReceiptAvailable(receipt: OriginalReference): Promise<boolean> {
  try {
    const provider = storageProviders[receipt.storageProvider];
    return !!receipt.storageReference && !!provider && await provider.isAvailable(receipt.storageReference);
  }
  catch { return false; }
}

export async function openReceipt(receipt: OriginalReference): Promise<void> {
  const provider = storageProviders[receipt.storageProvider];
  if (!provider || !receipt.storageReference) throw new Error('Original receipt unavailable');
  await provider.openReceipt(receipt.storageReference);
}

export async function saveReceiptAsset(
  providerId: StorageProviderId,
  asset: ReceiptAsset,
  receiptId: string,
  preparedReference?: string,
): Promise<StorageSaveResult> {
  return storageProviders[providerId].save(asset, receiptId, preparedReference);
}
