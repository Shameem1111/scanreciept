import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { HistoryManager, HistoryState } from '../services/historyManager';
import { clearReceiptSession } from '../services/receiptAuth';

type ReceiptStoreValue = HistoryState & Pick<HistoryManager, 'connectStorage' | 'disconnectStorage' | 'retryStorageCleanup' | 'addReceipt' | 'saveReceipt' | 'updateReceipt' | 'deleteReceipt' | 'setStorageProvider' | 'deleteHistory' | 'deleteEverything' | 'exportPurchaseHistory' | 'hydrate'>;
const ReceiptStoreContext = createContext<ReceiptStoreValue | null>(null);
export function ReceiptStoreProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<HistoryState>({ receipts: [], storageProvider: 'local', hydrated: false, recovery: null });
  const [manager] = useState(() => new HistoryManager(setState));
  useEffect(() => { void manager.hydrate(); }, [manager]);
  const value: ReceiptStoreValue = { ...state, connectStorage: manager.connectStorage, disconnectStorage: manager.disconnectStorage, retryStorageCleanup: manager.retryStorageCleanup, addReceipt: manager.addReceipt, saveReceipt: manager.saveReceipt,
    updateReceipt: manager.updateReceipt, deleteReceipt: manager.deleteReceipt, setStorageProvider: manager.setStorageProvider,
    deleteHistory: manager.deleteHistory, deleteEverything: async () => { clearReceiptSession(); await manager.deleteEverything(); },
    exportPurchaseHistory: manager.exportPurchaseHistory, hydrate: manager.hydrate };
  return <ReceiptStoreContext.Provider value={value}>{children}</ReceiptStoreContext.Provider>;
}
export function useReceiptStore() {
  const context = useContext(ReceiptStoreContext);
  if (!context) throw new Error('useReceiptStore must be used inside ReceiptStoreProvider');
  return context;
}
