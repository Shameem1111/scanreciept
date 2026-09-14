import { Linking } from 'react-native';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import type { ReceiptStorageProvider } from './storage';
import { connectGoogle, disconnectGoogle, forgetGoogleConnection, googleAuthorization, invalidateGoogleToken, isGoogleConfigured } from './googleDriveAuth';
import { StorageError } from './storageErrors';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id';
const ID = /^[a-zA-Z0-9_-]+$/;
function parseReference(reference: string) {
  const match = /^gdrive:\/\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/.exec(reference);
  if (!match) throw new StorageError('Original receipt unavailable: invalid Google Drive reference.');
  return { account: match[1]!, file: match[2]! };
}
// Never accept arbitrary URLs or forward bearer tokens to a caller-supplied host.
function trustedUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.googleapis.com' &&
    !url.port && !url.username && !url.password && (url.pathname.startsWith('/drive/v3/') || url.pathname.startsWith('/upload/drive/v3/')); }
  catch { return false; }
}
async function request(url: string, init: RequestInit = {}, account?: string): Promise<Response> {
  if (!trustedUrl(url)) throw new StorageError('Google Drive returned an invalid upload destination.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const auth = await googleAuthorization(account);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await expoFetch(url, { ...init, redirect: 'error', signal: controller.signal,
        headers: { ...init.headers, Authorization: `Bearer ${auth.token}` } });
    } catch { throw new StorageError('Google Drive could not be reached. Check your connection and retry.'); }
    finally { clearTimeout(timer); }
    if (response.status === 401) {
      if (attempt === 0) { await invalidateGoogleToken(auth.token); continue; }
      throw new StorageError('Google Drive authorization expired or was revoked. Connect again in Settings.');
    }
    if (response.status === 403) throw new StorageError('Google Drive denied access. Check receipt-file permission and available Drive storage, then reconnect or retry.');
    if (response.status === 429 || response.status >= 500) throw new StorageError('Google Drive is temporarily unavailable or busy. Retry shortly.');
    return response;
  }
  throw new StorageError('Connect Google Drive again in Settings.');
}
async function fileMetadata(reference: string): Promise<boolean> {
  const { account, file } = parseReference(reference);
  const response = await request(`${API}/files/${file}?fields=id,trashed`, {}, account);
  if (response.status === 404) return false;
  if (!response.ok) throw new StorageError('Original receipt unavailable in Google Drive.');
  const data = await response.json();
  return data.id === file && data.trashed === false;
}

export const googleDriveProvider: ReceiptStorageProvider = {
  id: 'google-drive', label: 'Google Drive',
  description: 'Originals upload to your own Drive after you connect. ReceiptMind requests access only to files it creates or you explicitly grant.',
  isConfigured: isGoogleConfigured,
  connect: connectGoogle,
  disconnect: disconnectGoogle,
  forgetConnection: forgetGoogleConnection,
  async connectionStatus() {
    if (!isGoogleConfigured()) return 'Setup required: public mobile OAuth IDs and a native build. See README.';
    try { await googleAuthorization(); return 'Connected. New originals can be stored in your Google Drive.'; }
    catch { return 'Disconnected or authorization unavailable. Connect again; saved history is kept.'; }
  },
  async isAvailable(reference) {
    try { if (reference) return await fileMetadata(reference); await googleAuthorization(); return true; }
    catch { return false; }
  },
  async prepareSave() {
    const { account } = await googleAuthorization();
    const response = await request(`${API}/files/generateIds?count=1&space=drive&type=files`, {}, account);
    if (!response.ok) throw new StorageError('Could not reserve a Google Drive file. Retry.');
    const data = await response.json();
    const file = data.ids?.[0];
    if (typeof file !== 'string' || !ID.test(file) || !ID.test(account)) throw new StorageError('Google Drive returned an invalid file reference.');
    return `gdrive://${account}/${file}`;
  },
  async save(asset, receiptId, preparedReference) {
    if (!preparedReference) throw new StorageError('A journaled file reference is required before a Drive upload.');
    const { account, file } = parseReference(preparedReference);
    const source = new File(asset.uri);
    if (!source.exists || source.size <= 0) throw new StorageError('The receipt input is unavailable. Select it again.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'].includes(asset.mimeType)) throw new StorageError('Choose a receipt image or PDF.');
    const start = await request(UPLOAD, { method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Upload-Content-Type': asset.mimeType, 'X-Upload-Content-Length': String(source.size) },
      // No merchant/items, original filename or payment metadata is sent as searchable metadata.
      body: JSON.stringify({ id: file, name: `${receiptId}.${asset.mimeType === 'application/pdf' ? 'pdf' : asset.mimeType.split('/')[1]}`, mimeType: asset.mimeType }),
    }, account);
    if (!start.ok) throw new StorageError('Could not start the Google Drive upload. Retry.');
    const location = start.headers.get('Location');
    if (!location || !trustedUrl(location)) throw new StorageError('Google Drive returned an invalid upload destination.');
    const uploaded = await request(location, { method: 'PUT', headers: { 'Content-Type': asset.mimeType }, body: source }, account);
    if (!uploaded.ok) throw new StorageError('Google Drive upload did not finish. Retry after checking your connection and Drive storage.');
    const result = await uploaded.json();
    if (result.id !== file) throw new StorageError('Google Drive did not confirm the reserved receipt file.');
    return { provider: 'google-drive', reference: preparedReference };
  },
  async openReceipt(reference) {
    if (!await fileMetadata(reference)) throw new StorageError('Original receipt unavailable. It may have been deleted or moved to trash. Structured history is kept.');
    const { file } = parseReference(reference);
    try { await Linking.openURL(`https://drive.google.com/file/d/${file}/view`); }
    catch { throw new StorageError('Could not open Google Drive. Install a browser or Drive app and retry.'); }
  },
  async deleteReceipt(reference) {
    const { account, file } = parseReference(reference);
    const response = await request(`${API}/files/${file}`, { method: 'DELETE' }, account);
    if (!response.ok && response.status !== 404) throw new StorageError('The incomplete Drive upload could not be removed. Reconnect its original account and retry cleanup.');
  },
};
