import { File } from 'expo-file-system';
import { ExtractedReceipt, ReceiptAsset, ReceiptItem } from '../types';
import { sanitizeItemText, sanitizeMerchant } from './privacy';

const categories = new Set(['Food', 'Medicine', 'Clothing', 'Household', 'Electronics', 'Transport', 'Restaurant', 'Travel', 'Personal Care', 'Entertainment', 'Other']);

const DEFAULT_RECEIPT_AI_ENDPOINT =
  'https://receiptmind-api.r7tg4t4tcc.workers.dev/receipt/extract';
const endpoint = process.env.EXPO_PUBLIC_RECEIPT_AI_ENDPOINT?.trim() || DEFAULT_RECEIPT_AI_ENDPOINT;

function sanitizeExtractedReceipt(input: ExtractedReceipt): ExtractedReceipt {
  const items: ReceiptItem[] = (input.items ?? [])
    .map((item, index) => ({
      id: `item-${Date.now()}-${index}`,
      category: categories.has(item.category) ? item.category : 'Other',
      originalText: sanitizeItemText(item.originalText || item.name || ''),
      name: sanitizeItemText(item.name || item.originalText || 'Unknown item'),
      quantity: Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 1,
      price: Number.isFinite(item.price) ? Math.max(0, item.price) : 0,
      confidence: Number.isFinite(item.confidence) ? Math.min(1, Math.max(0, item.confidence)) : 0,
    }))
    .filter((item) => item.name !== '[PAYMENT INFORMATION REMOVED]' && item.originalText !== '[PAYMENT INFORMATION REMOVED]');

  return {
    merchant: sanitizeMerchant(input.merchant || 'Unknown merchant'),
    purchaseDate: input.purchaseDate,
    total: input.total,
    source: 'ai',
    currency: 'EUR',
    items,
  };
}

export async function extractReceipt(asset: ReceiptAsset): Promise<ExtractedReceipt> {
  if (!endpoint) {
    throw new Error('Receipt reading is not configured in this build. Configure the receipt extraction service and restart the app, then retry.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    // Expo's fetch requires file bytes; React Native URI-only parts are unsupported.
    const file = new File(asset.uri);
    const receipt = new Blob([await file.arrayBuffer()], { type: asset.mimeType });
    const form = new FormData();
    form.append('receipt', receipt, asset.name);
    form.append('privacy_mode', 'no-payment-data');

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Receipt extraction failed (${response.status})`);
    }

    const result = (await response.json()) as ExtractedReceipt;
    if (!result || result.source === 'demo' || typeof result.merchant !== 'string' ||
        typeof result.purchaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.purchaseDate) ||
        !Number.isFinite(result.total) || result.total < 0 || result.currency !== 'EUR' ||
        !Array.isArray(result.items) || result.items.some((item) => !item ||
          typeof item.name !== 'string' || typeof item.originalText !== 'string' ||
          typeof item.category !== 'string' || !Number.isFinite(item.price))) {
      throw new Error('The receipt service returned an invalid result. Please try again.');
    }
    const sanitized = sanitizeExtractedReceipt(result);
    if (sanitized.items.length === 0) {
      throw new Error('No purchase items could be read. Try a clearer photo of the full receipt.');
    }
    return sanitized;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Receipt reading timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
