import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { fetch } from 'expo/fetch';
import { isGoogleConfigured, receiptAuthorization as googleAuthorization } from './googleDriveAuth';

export const receiptEndpoint = process.env.EXPO_PUBLIC_RECEIPT_AI_ENDPOINT?.trim() ||
  'https://receiptmind-api.r7tg4t4tcc.workers.dev/receipt/extract';
export type ReceiptAuthProvider = 'apple' | 'google';
type Session = { token: string; expiresAt: number; provider: ReceiptAuthProvider; appleUser?: string };
// Short-lived credentials stay in memory, never in purchase history or AsyncStorage.
let session: Session | null = null;
let generation = 0;
const listeners = new Set<() => void>();
export function subscribeReceiptAuth(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function clearReceiptSession() {
  generation++;
  session = null;
  listeners.forEach(listener => listener());
}
export function isReceiptSignedIn(): boolean {
  return !!session && session.expiresAt > Date.now() + 30_000;
}
export function getReceiptAuthProvider(): ReceiptAuthProvider | null {
  return isReceiptSignedIn() ? session!.provider : null;
}
export function getReceiptAuthExpiresAt(): number | null {
  return isReceiptSignedIn() ? session!.expiresAt : null;
}
export function isReceiptGoogleConfigured(): boolean {
  return /^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '') && isGoogleConfigured();
}
export async function receiptAuthorization(): Promise<string> {
  if (!isReceiptSignedIn()) {
    clearReceiptSession();
    throw new Error('Sign in before scanning or uploading a receipt.');
  }
  const current = session!;
  if (current.appleUser) {
    try {
      const state = await AppleAuthentication.getCredentialStateAsync(current.appleUser);
      if (state !== AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED) throw new Error();
    } catch {
      clearReceiptSession();
      throw new Error('Apple sign-in is no longer available. Sign in again before scanning.');
    }
  }
  if (session !== current || !isReceiptSignedIn()) throw new Error('Sign in again before scanning.');
  return current.token;
}
export async function signInForReceipts(provider: ReceiptAuthProvider): Promise<void> {
  clearReceiptSession();
  const attempt = generation;
  let selectedProvider = provider;
  let token: string;
  let appleUser: string | undefined;

  if (selectedProvider === 'apple') {
    const appleAvailable = Platform.OS === 'ios' && await AppleAuthentication.isAvailableAsync();
    if (!appleAvailable) {
      if (isReceiptGoogleConfigured()) selectedProvider = 'google';
      else throw new Error('Apple sign-in is unavailable on this device and Google receipt sign-in is not configured in this build.');
    }
  }

  if (selectedProvider === 'apple') {
    try {
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      if (!credential.identityToken) throw new Error();
      token = credential.identityToken;
      appleUser = credential.user;
    } catch { throw new Error('Apple sign-in was cancelled or could not finish. Please try again.'); }
  } else {
    token = await googleAuthorization();
  }
  const url = new URL(receiptEndpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Receipt sign-in is unavailable in this app version.');
  url.pathname = '/receipt/session';
  url.search = '';
  url.hash = '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url.toString(), { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    const result = await response.json().catch(() => null) as { expiresAt?: unknown; code?: unknown } | null;
    if (!response.ok) {
      if (response.status === 401) throw new Error('Sign-in could not be verified. Please sign in again.');
      if (result?.code === 'RATE_LIMITED') throw new Error('Too many sign-in attempts. Wait a minute and try again.');
      throw new Error('Receipt scanning is not available yet. The app owner needs to finish service setup.');
    }
    if (typeof result?.expiresAt !== 'number' || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now() + 30_000) throw new Error('Sign-in expired. Please try again.');
    if (generation !== attempt) throw new Error('Sign-in was interrupted. Please try again.');
    session = { token, provider: selectedProvider, appleUser, expiresAt: Math.min(result.expiresAt, Date.now() + 3_600_000) };
    listeners.forEach(listener => listener());
  } finally { clearTimeout(timer); }
}
