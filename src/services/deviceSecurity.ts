import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { parseLockSettings, type LockSettings } from './appLock';

const LOCK_KEY = 'receiptmind-app-lock-v1';
let screenPrivacyReady = false;
let screenPrivacyAttempt = 0;
export async function prepareScreenPrivacy(): Promise<void> {
  if (screenPrivacyReady) return;
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('A native build is required.');
  // Expo remembers a tag even if the native call fails. A fresh tag ensures a
  // retry actually reaches native code instead of silently treating it as protected.
  await ScreenCapture.preventScreenCaptureAsync(`receiptmind-${++screenPrivacyAttempt}`);
  if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(1);
  screenPrivacyReady = true;
}
export async function readLockSettings() { return parseLockSettings(await SecureStore.getItemAsync(LOCK_KEY)); }
export async function writeLockSettings(settings: LockSettings) {
  await SecureStore.setItemAsync(LOCK_KEY, JSON.stringify(settings), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function clearLockSettings() { await SecureStore.deleteItemAsync(LOCK_KEY); }
export async function authenticateDevice(): Promise<boolean> {
  if (await LocalAuthentication.getEnrolledLevelAsync() === LocalAuthentication.SecurityLevel.NONE) return false;
  const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock ReceiptMind',
    cancelLabel: 'Cancel', fallbackLabel: 'Use device passcode', disableDeviceFallback: false,
    biometricsSecurityLevel: 'strong', requireConfirmation: true });
  return result.success;
}
