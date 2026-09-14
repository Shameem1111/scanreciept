import { Platform } from 'react-native';
import type { GoogleSignin as GoogleSigninType } from '@react-native-google-signin/google-signin';
import { StorageError } from './storageErrors';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID = /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/;
const setupMessage = 'Google Drive needs mobile OAuth setup and a native development or release build. See README Google Drive setup; Expo Go is not supported.';
const reconnectMessage = 'Google Drive authorization is unavailable or expired. Connect again in Settings and grant receipt-file access.';
let configured = false;

function sdk(): typeof GoogleSigninType {
  try {
    // Lazy loading keeps local storage usable in Expo Go and unconfigured builds.
    const client = (require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin')).GoogleSignin;
    if (!client?.configure) throw new Error();
    return client;
  } catch { throw new StorageError(setupMessage); }
}
export function isGoogleConfigured(): boolean {
  const id = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID :
    Platform.OS === 'android' ? process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID : undefined;
  if (!id || !CLIENT_ID.test(id)) return false;
  try { sdk(); return true; } catch { return false; }
}
function configuredSdk() {
  if (!isGoogleConfigured()) throw new StorageError(setupMessage);
  const client = sdk();
  if (!configured) {
    client.configure({ scopes: [DRIVE_SCOPE], offlineAccess: false,
      ...(Platform.OS === 'ios' ? { iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID } : {}) });
    configured = true;
  }
  return client;
}
export async function connectGoogle(): Promise<void> {
  const client = configuredSdk();
  try {
    if (!await client.hasPlayServices({ showPlayServicesUpdateDialog: true })) throw new Error();
    let result = await client.signIn();
    if (result.type !== 'success') throw new StorageError('Google sign-in was cancelled. Storage selection has not changed.');
    if (!result.data.scopes.includes(DRIVE_SCOPE)) {
      const extra = await client.addScopes({ scopes: [DRIVE_SCOPE] });
      if (!extra || extra.type !== 'success') throw new StorageError('Receipt-file access was not granted. Connect again to use Google Drive.');
      result = extra;
    }
    if (!result.data.scopes.includes(DRIVE_SCOPE)) throw new StorageError('Receipt-file access was not granted. Connect again to use Google Drive.');
    await client.getTokens();
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('Could not connect Google Drive. Check your internet connection, Google Play services and mobile OAuth configuration, then try again.');
  }
}
export async function googleAuthorization(expectedAccount?: string): Promise<{ account: string; token: string }> {
  const client = configuredSdk();
  try {
    const result = await client.signInSilently();
    if (result.type !== 'success' || !result.data.scopes.includes(DRIVE_SCOPE)) throw new StorageError(reconnectMessage);
    const account = result.data.user.id;
    if (expectedAccount && account !== expectedAccount) throw new StorageError('This original belongs to a different Google account. Disconnect and connect its original account in Settings.');
    const { accessToken } = await client.getTokens();
    if (!accessToken || !account) throw new Error();
    // Profile/email/id tokens returned by the SDK are deliberately not stored or logged.
    return { account, token: accessToken };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError(reconnectMessage);
  }
}
export async function invalidateGoogleToken(token: string): Promise<void> {
  try { await configuredSdk().clearCachedAccessToken(token); }
  catch { throw new StorageError(reconnectMessage); }
}
export async function disconnectGoogle(): Promise<void> {
  const client = configuredSdk();
  let revoked = false;
  try { await client.revokeAccess(); revoked = true; }
  catch { /* Local sign-out must still run if revocation cannot reach Google. */ }
  try { await client.signOut(); }
  catch { throw new StorageError('Google sign-out could not finish. Retry Disconnect before handing this device to someone else.'); }
  if (!revoked) throw new StorageError('Signed out on this device. Google access could not be revoked; retry online or remove ReceiptMind in your Google Account connections. Original files and history were kept.');
}
export async function forgetGoogleConnection(): Promise<void> {
  // Device reset clears local SDK credentials without deleting cloud files or requiring remote revocation.
  let client: typeof GoogleSigninType;
  try { client = sdk(); } catch { return; } // This binary cannot contain the native SDK's session.
  try {
    // Android signOut requires its native client even when OAuth IDs are unset in this build.
    // Native configure initializes that client before the subsequently queued signOut call.
    if (Platform.OS === 'android' && !configured) {
      client.configure({ scopes: [DRIVE_SCOPE], offlineAccess: false });
      configured = true;
    }
    await client.signOut();
  }
  catch { throw new StorageError('Could not clear the Google session. Retry device deletion.'); }
}
