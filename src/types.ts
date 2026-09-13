export type StorageProviderId = 'local' | 'google-drive' | 'icloud';

export type Category =
  | 'Food'
  | 'Medicine'
  | 'Clothing'
  | 'Household'
  | 'Electronics'
  | 'Transport'
  | 'Restaurant'
  | 'Travel'
  | 'Personal Care'
  | 'Entertainment'
  | 'Other';

export type ReceiptItem = {
  id: string;
  originalText: string;
  name: string;
  category: Category;
  quantity: number;
  price: number;
  confidence: number;
};

export type Receipt = {
  id: string;
  merchant: string;
  purchaseDate: string;
  total: number;
  printedTotal?: number;
  currency: 'EUR';
  items: ReceiptItem[];
  storageProvider: StorageProviderId;
  storageReference: string;
  originalFilename: string;
  createdAt: string;
  source: 'ai' | 'demo';
};

export type ExtractedReceipt = Omit<
  Receipt,
  'id' | 'storageProvider' | 'storageReference' | 'originalFilename' | 'createdAt'
>;

export type ReceiptAsset = {
  uri: string;
  name: string;
  mimeType: string;
};
