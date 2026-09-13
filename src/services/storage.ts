import { Directory, File, Paths } from 'expo-file-system';
import { ReceiptAsset, StorageProviderId } from '../types';

export type StorageSaveResult = {
  provider: StorageProviderId;
  reference: string;
};

export interface ReceiptStorageProvider {
  id: StorageProviderId;
  label: string;
  isConfigured(): boolean;
  save(asset: ReceiptAsset, receiptId: string): Promise<StorageSaveResult>;
}

const localProvider: ReceiptStorageProvider = {
  id: 'local',
  label: 'This device',
  isConfigured: () => true,
  async save(asset, receiptId) {
    const directory = new Directory(Paths.document, 'ReceiptMind', 'Receipts');
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });

    const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destination = new File(directory, `${receiptId}-${safeName}`);
    const source = new File(asset.uri);
    await source.copy(destination, { overwrite: true });
    return { provider: 'local', reference: destination.uri };
  },
};

function unconfiguredProvider(id: Exclude<StorageProviderId, 'local'>, label: string): ReceiptStorageProvider {
  return {
    id,
    label,
    isConfigured: () => false,
    async save() {
      throw new Error(`${label} is not configured in this build yet.`);
    },
  };
}

export const storageProviders: Record<StorageProviderId, ReceiptStorageProvider> = {
  local: localProvider,
  'google-drive': unconfiguredProvider('google-drive', 'Google Drive'),
  icloud: unconfiguredProvider('icloud', 'iCloud Drive'),
};

export async function saveReceiptAsset(
  providerId: StorageProviderId,
  asset: ReceiptAsset,
  receiptId: string,
): Promise<StorageSaveResult> {
  return storageProviders[providerId].save(asset, receiptId);
}
