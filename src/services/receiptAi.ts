import { File } from 'expo-file-system';
import { demoReceipt } from '../data';
import { ExtractedReceipt, ReceiptAsset, ReceiptItem } from '../types';
import { sanitizeItemText, sanitizeMerchant } from './privacy';

const endpoint = process.env.EXPO_PUBLIC_RECEIPT_AI_ENDPOINT?.trim();

function sanitizeExtractedReceipt(input: ExtractedReceipt): ExtractedReceipt {
  const items: ReceiptItem[] = (input.items ?? [])
    .map((item, index) => ({
      ...item,
      id: item.id || `item-${Date.now()}-${index}`,
      originalText: sanitizeItemText(item.originalText || item.name || ''),
      name: sanitizeItemText(item.name || item.originalText || 'Unknown item'),
      quantity: Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 1,
      price: Number.isFinite(item.price) ? Math.max(0, item.price) : 0,
      confidence: Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)) : 0,
    }))
    .filter((item) => item.name !== '[PAYMENT INFORMATION REMOVED]' && item.originalText !== '[PAYMENT INFORMATION REMOVED]');

  return {
    ...input,
    merchant: sanitizeMerchant(input.merchant || 'Unknown merchant'),
    currency: 'EUR',
    items,
  };
}

export async function extractReceipt(asset: ReceiptAsset): Promise<ExtractedReceipt> {
  if (!endpoint) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return demoReceipt;
  }

  const form = new FormData();
  const file = new File(asset.uri);
  form.append('receipt', file as unknown as Blob);
  form.append('privacy_mode', 'no-payment-data');

  const response = await fetch(endpoint, {
    method: 'POST',
    body: form,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Receipt extraction failed (${response.status})`);
  }

  const result = (await response.json()) as ExtractedReceipt;
  return sanitizeExtractedReceipt({ ...result, source: 'ai' });
}
