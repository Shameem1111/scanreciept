import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_NAME = 'receiptmind-local-aes-key-v1';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}

async function getKey(): Promise<AESEncryptionKey> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing) return AESEncryptionKey.import(existing, 'hex');

  const generated = await AESEncryptionKey.generate();
  const encoded = await generated.encoded('hex');
  await SecureStore.setItemAsync(KEY_NAME, encoded, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

export async function setEncryptedJson(key: string, value: unknown): Promise<void> {
  const encryptionKey = await getKey();
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const sealed = await aesEncryptAsync(bytes, encryptionKey);
  const combined = await sealed.combined();
  await AsyncStorage.setItem(key, bytesToHex(combined));
}

export async function getEncryptedJson<T>(key: string): Promise<T | null> {
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return null;

  try {
    const encryptionKey = await getKey();
    const sealed = AESSealedData.fromCombined(hexToBytes(stored));
    const decrypted = await aesDecryptAsync(sealed, encryptionKey, { output: 'bytes' });
    if (typeof decrypted === 'string') return JSON.parse(decrypted) as T;
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    return null;
  }
}

export async function removeEncryptedJson(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
