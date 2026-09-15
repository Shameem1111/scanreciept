import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as ScreenCapture from 'expo-screen-capture';

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
// Remove settings created by older builds that offered device PIN/biometric login.
export async function clearLockSettings() { await SecureStore.deleteItemAsync(LOCK_KEY); }
