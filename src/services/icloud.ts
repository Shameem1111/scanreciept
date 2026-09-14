import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { ReceiptStorageProvider } from './storage';
import { StorageError } from './storageErrors';

type ICloudModule = {
  status(): Promise<string>;
  prepare(extension: string): Promise<string>;
  exists(reference: string): Promise<boolean>;
  save(source: string, reference: string): Promise<void>;
  read(reference: string): Promise<string>;
  remove(reference: string): Promise<void>;
};
function native(): ICloudModule | null {
  if (Platform.OS !== 'ios') return null;
  try { return require('expo-modules-core').requireOptionalNativeModule('ReceiptMindICloud'); }
  catch { return null; }
}
async function status(): Promise<string> {
  if (Platform.OS !== 'ios') return 'iCloud Drive is available only on iOS. Choose This device or Google Drive on Android.';
  const module = native();
  if (!module) return 'iCloud requires a native iPhone build with Apple container and signing setup; Expo Go is not supported.';
  try {
    const state = await module.status();
    if (state === 'available') return 'Available. Originals sync through your iCloud Drive; upload completion depends on network and iCloud storage.';
    if (state === 'signed-out') return 'Sign in to your Apple Account and enable iCloud Drive in iPhone Settings.';
  } catch { /* Only safe, actionable messages cross the native boundary. */ }
  return 'iCloud Drive is unavailable. Enable iCloud Drive for ReceiptMind and check this build’s container and signing configuration.';
}
async function availableModule(): Promise<ICloudModule> {
  const module = native();
  if (module) {
    try { if (await module.status() === 'available') return module; } catch { /* Explain below. */ }
  }
  throw new StorageError(await status());
}
export const icloudProvider: ReceiptStorageProvider = {
  id: 'icloud', label: 'iCloud Drive',
  description: 'Store originals in your own iCloud Drive on iPhone. Manage sign-in and iCloud Drive access in iPhone Settings.',
  isConfigured: () => !!native(),
  connectionStatus: status,
  async cleanupTemporaryFiles() {
    if (Platform.OS !== 'ios') return;
    const directory = new Directory(Paths.cache, 'ReceiptMindICloudPreviews');
    if (directory.exists) directory.delete();
  },
  async isAvailable(reference) {
    try { const module = await availableModule(); return reference === undefined || await module.exists(reference); }
    catch { return false; }
  },
  async prepareSave(asset) {
    const module = await availableModule();
    const extension = ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp' } as Record<string, string>)[asset.mimeType];
    if (!extension) throw new StorageError('Unsupported receipt format. Choose a PDF, JPEG, PNG, HEIC or WebP file.');
    try { return await module.prepare(extension); }
    catch { throw new StorageError('Could not prepare iCloud storage. Check iCloud Drive access and retry.'); }
  },
  async save(asset, _id, reference) {
    const module = await availableModule();
    if (!reference) throw new StorageError('An iCloud original must be journaled before saving.');
    try { await module.save(asset.uri, reference); }
    catch { throw new StorageError('Could not save the iCloud original. Check your original Apple Account, iCloud Drive access and free storage, then retry.'); }
    return { provider: 'icloud', reference };
  },
  async openReceipt(reference) {
    let module: ICloudModule;
    try { module = await availableModule(); }
    catch (error) { throw new StorageError(`Original receipt unavailable. ${error instanceof StorageError ? error.message : 'Check iCloud Drive access.'}`); }
    let preview: File | undefined;
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error();
      preview = new File(await module.read(reference));
      await Sharing.shareAsync(preview.uri, { dialogTitle: 'View original receipt' });
    } catch { throw new StorageError('Original receipt unavailable. Check the original Apple Account, iCloud Drive and internet connection, then retry. Purchase history is still available.'); }
    finally {
      if (preview?.exists) {
        try { preview.delete(); }
        catch { throw new StorageError('Could not remove the temporary receipt preview. Restart the app to retry cleanup.'); }
      }
    }
  },
  async deleteReceipt(reference) {
    const module = await availableModule();
    try { await module.remove(reference); }
    catch { throw new StorageError('Incomplete iCloud original cleanup is pending. Restore the original Apple Account and iCloud Drive access, then retry original cleanup in Settings.'); }
  },
};
