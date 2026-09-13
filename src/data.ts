import { ExtractedReceipt } from './types';

export const demoReceipt: ExtractedReceipt = {
  merchant: 'REWE',
  purchaseDate: '2026-09-13',
  total: 16.67,
  currency: 'EUR',
  source: 'demo',
  items: [
    { id: 'demo-1', originalText: 'BIO BANANEN', name: 'Organic Bananas', category: 'Food', quantity: 1, price: 2.49, confidence: 0.98 },
    { id: 'demo-2', originalText: 'MILCH 1L', name: 'Milk 1L', category: 'Food', quantity: 1, price: 1.29, confidence: 0.98 },
    { id: 'demo-3', originalText: 'PERSIL', name: 'Persil Detergent', category: 'Household', quantity: 1, price: 7.99, confidence: 0.93 },
    { id: 'demo-4', originalText: 'DEMO MEDICINE', name: 'Demo Medicine', category: 'Medicine', quantity: 1, price: 4.90, confidence: 0.99 }
  ]
};
