import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { ReceiptAsset } from '../types';

export type ReceiptInput = 'camera' | 'gallery' | 'file';
export class ReceiptInputError extends Error {
  constructor(message: string, readonly openSettings = false) { super(message); }
}
export async function pickReceipt(source: ReceiptInput): Promise<ReceiptAsset | null> {
  try {
    if (source === 'file') {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets[0]) return null;
      const file = result.assets[0];
      if (file.size !== undefined && file.size > 10 * 1024 * 1024) throw new ReceiptInputError('Choose a receipt smaller than 10 MB.');
      return { uri: file.uri, name: file.name, mimeType: file.mimeType ?? 'application/octet-stream' };
    }
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) throw new ReceiptInputError('Allow camera access to scan a receipt. You can still upload a photo or PDF.', !permission.canAskAgain);
    }
    // The system photo picker grants access to the selected image. No broad
    // gallery, storage, microphone or location permission is requested.
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
    if (result.canceled || !result.assets[0]) return null;
    const image = result.assets[0];
    if (image.fileSize !== undefined && image.fileSize > 10 * 1024 * 1024) throw new ReceiptInputError('Choose a receipt smaller than 10 MB.');
    const mimeType = image.mimeType ?? 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new ReceiptInputError('Export this image as JPEG or PNG, or choose a PDF receipt.');
    return { uri: image.uri, name: image.fileName ?? `receipt-${Date.now()}.jpg`, mimeType };
  } catch (error) {
    if (error instanceof ReceiptInputError) throw error;
    throw new ReceiptInputError('The receipt picker could not open. Check device permissions and try again.');
  }
}
