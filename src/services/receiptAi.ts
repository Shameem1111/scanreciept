import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { ExtractedReceipt, ReceiptAsset, ReceiptItem } from '../types';
import { validPurchaseDate } from './receiptReview';
import { sanitizeItemText, sanitizeMerchant } from './privacy';
import { clearReceiptSession, receiptAuthorization, receiptEndpoint } from './receiptAuth';

const categories = new Set(['Food', 'Medicine', 'Clothing', 'Household', 'Electronics', 'Transport', 'Restaurant', 'Travel', 'Personal Care', 'Entertainment', 'Other']);

const endpoint = receiptEndpoint;
const extractionErrors: Record<string, string> = {
  AUTH_REQUIRED: 'Sign in to read receipts, then retry.',
  AUTH_INVALID: 'Your receipt sign-in expired. Sign out in Settings, sign in and retry.',
  AUTH_UNAVAILABLE: 'Sign-in verification is temporarily unavailable. Try again shortly.',
  RATE_LIMITED: 'Too many scan requests. Wait a minute before trying again.',
  SCAN_ALLOWANCE_EXHAUSTED: 'The scan allowance has been reached for this account or network. Try after it resets.',
  SCANS_DISABLED: 'Receipt scanning is temporarily paused. Try again later.',
  SERVICE_CONFIG: 'Receipt scanning needs service configuration. Contact the service owner.',
  LIMITER_UNAVAILABLE: 'Receipt scanning is temporarily unavailable. Try again shortly.',
  UPLOAD_TOO_LARGE: 'Choose a receipt file smaller than 10 MB.',
  UNSUPPORTED_FILE: 'Choose a valid JPEG, PNG, WebP or PDF receipt.',
  UPLOAD_TIMEOUT: 'The receipt upload timed out. Check your connection and retry.',
  PROVIDER_AUTH: 'The receipt AI service credentials need attention. The service owner must check the backend API key.',
  PROVIDER_CONFIG: 'The receipt AI service is not configured correctly. The service owner must check the backend API key and model.',
  PROVIDER_QUOTA: 'The receipt AI service scan limit has been reached. Try later; the service owner may need to check quota or billing.',
  PROVIDER_UNAVAILABLE: 'The receipt AI service is temporarily unavailable. Please try again shortly.',
  PROVIDER_TIMEOUT: 'Receipt reading timed out. Please try again.',
  INVALID_AI_RESPONSE: 'The AI service returned an unreadable result. Please retry the receipt.',
  UNREADABLE_RECEIPT: 'Could not reliably read the items. Try a clearer image of the complete German or English receipt.',
  INVALID_UPLOAD: 'Receipt upload was invalid. Select the file again and retry.',
};

// Keep picker metadata even when the cached file has a different name or extension.
class ReceiptUploadFile extends File {
  constructor(private readonly asset: ReceiptAsset) {
    super(asset.uri);
    Object.defineProperty(this, 'type', { value: asset.mimeType });
  }

  get name() { return this.asset.name; }
}

function sanitizeExtractedReceipt(input: ExtractedReceipt): ExtractedReceipt {
  const items: ReceiptItem[] = (input.items ?? [])
    .map((item, index) => ({
      id: `item-${Date.now()}-${index}`,
      category: categories.has(item.category) ? item.category : 'Other',
      originalText: sanitizeItemText(item.originalText || item.name || ''),
      name: sanitizeItemText(item.name || item.originalText || 'Unknown item'),
      quantity: Number.isFinite(item.quantity) ? item.quantity : 0,
      price: Number.isFinite(item.price) ? Math.max(0, item.price) : 0,
      confidence: Number.isFinite(item.confidence) && item.quantity > 0 && categories.has(item.category) ? Math.min(1, Math.max(0, item.confidence)) : 0,
    }))
    .filter((item) => item.name !== '[PAYMENT INFORMATION REMOVED]' && item.originalText !== '[PAYMENT INFORMATION REMOVED]');

  return {
    merchant: sanitizeMerchant(input.merchant || 'Unknown merchant'),
    purchaseDate: validPurchaseDate(input.purchaseDate),
    total: input.total,
    source: 'ai',
    currency: 'EUR',
    items,
  };
}

export async function extractReceipt(asset: ReceiptAsset): Promise<ExtractedReceipt> {
  if (!/^https:\/\//i.test(endpoint)) {
    throw new Error('Receipt reading is not configured in this build. Configure the receipt extraction service and restart the app, then retry.');
  }

  const token = await receiptAuthorization();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    // Expo reads File.bytes() directly without React Native's unsupported Blob conversion.
    const receipt = new ReceiptUploadFile(asset);
    const form = new FormData();
    form.append('receipt', receipt);
    form.append('privacy_mode', 'no-payment-data');

    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401) clearReceiptSession();
      // Only display known messages, never raw provider errors or receipt contents.
      const failure = await response.json().catch(() => null) as { code?: unknown } | null;
      if (typeof failure?.code === 'string' && Object.hasOwn(extractionErrors, failure.code)) {
        throw new Error(extractionErrors[failure.code]);
      }
      if (response.status === 502 || response.status === 503) {
        throw new Error(`The receipt AI service could not complete extraction (${response.status}). Please retry. If this continues, the service owner needs to check the backend provider configuration and quota.`);
      }
      throw new Error(`Receipt extraction failed (${response.status})`);
    }

    const result = (await response.json()) as ExtractedReceipt;
    if (!result || result.source === 'demo' || typeof result.merchant !== 'string' ||
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
