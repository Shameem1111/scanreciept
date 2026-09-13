import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { getEncryptedJson, removeEncryptedJson, setEncryptedJson } from '../services/encryptedStore';
import { Receipt, StorageProviderId } from '../types';

const RECEIPTS_KEY = '@receiptmind/receipts/encrypted-v1';
const SETTINGS_KEY = '@receiptmind/settings/v1';

type ReceiptStoreValue = {
  receipts: Receipt[];
  storageProvider: StorageProviderId;
  hydrated: boolean;
  addReceipt: (receipt: Receipt) => Promise<void>;
  setStorageProvider: (provider: StorageProviderId) => Promise<void>;
  clearAll: () => Promise<void>;
};

const ReceiptStoreContext = createContext<ReceiptStoreValue | null>(null);

export function ReceiptStoreProvider({ children }: PropsWithChildren) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [storageProvider, setStorageProviderState] = useState<StorageProviderId>('local');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedReceipts, settingsJson] = await Promise.all([
          getEncryptedJson<Receipt[]>(RECEIPTS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (savedReceipts) setReceipts(savedReceipts);
        if (settingsJson) {
          const settings = JSON.parse(settingsJson) as { storageProvider?: StorageProviderId };
          if (settings.storageProvider) setStorageProviderState(settings.storageProvider);
        }
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  async function addReceipt(receipt: Receipt) {
    const next = [receipt, ...receipts];
    setReceipts(next);
    await setEncryptedJson(RECEIPTS_KEY, next);
  }

  async function setStorageProvider(provider: StorageProviderId) {
    setStorageProviderState(provider);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ storageProvider: provider }));
  }

  async function clearAll() {
    setReceipts([]);
    await removeEncryptedJson(RECEIPTS_KEY);
  }

  const value = useMemo(
    () => ({ receipts, storageProvider, hydrated, addReceipt, setStorageProvider, clearAll }),
    [receipts, storageProvider, hydrated],
  );

  return <ReceiptStoreContext.Provider value={value}>{children}</ReceiptStoreContext.Provider>;
}

export function useReceiptStore() {
  const context = useContext(ReceiptStoreContext);
  if (!context) throw new Error('useReceiptStore must be used inside ReceiptStoreProvider');
  return context;
}
