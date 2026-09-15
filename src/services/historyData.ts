import { Receipt } from '../types';
import { createReviewDraft, validateReview } from './receiptReview';
import { sanitizeItemText } from './privacy';

export const SAVE_ERROR = 'Could not save purchase history. Your previous history is preserved. Free device storage, unlock the device and try again.';
export const RECOVERY_MESSAGE = 'Local history could not be read. It may be corrupted, undecryptable or temporarily unavailable. Unlock the device and retry. Existing data has not been replaced. You can explicitly delete history to start again; originals are kept.';

// Validate the whole document before publishing any records. Never treat invalid data as empty.
export function validateHistory(value: unknown): Receipt[] {
  if (!Array.isArray(value)) throw new Error(RECOVERY_MESSAGE);
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error(RECOVERY_MESSAGE);
    const r = entry as Receipt;
    if (typeof r.id !== 'string' || !r.id || ids.has(r.id) ||
      !['local', 'google-drive', 'icloud'].includes(r.storageProvider) ||
      typeof r.storageReference !== 'string' || typeof r.originalFilename !== 'string' ||
      typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) ||
      r.currency !== 'EUR' || !['ai', 'demo', 'manual'].includes(r.source) ||
      typeof r.merchant !== 'string' || typeof r.purchaseDate !== 'string' ||
      typeof r.total !== 'number' || !Array.isArray(r.items) ||
      r.items.some(i => !i || typeof i.name !== 'string' || typeof i.originalText !== 'string' ||
        typeof i.quantity !== 'number' || typeof i.price !== 'number')) throw new Error(RECOVERY_MESSAGE);
    const checked = validateReview(createReviewDraft(r));
    if (!checked.receipt) throw new Error(RECOVERY_MESSAGE);
    ids.add(r.id);
    return { ...checked.receipt, id: r.id, storageProvider: r.storageProvider,
      storageReference: r.storageReference, originalFilename: sanitizeItemText(r.originalFilename), createdAt: r.createdAt };
  });
}

export function exportHistory(receipts: Receipt[]): string {
  return JSON.stringify({ format: 'ReceiptMind', version: 1, exportedAt: new Date().toISOString(),
    receipts: validateHistory(receipts) }, null, 2);
}

export function hasDuplicate(receipts: Receipt[], candidate: Pick<Receipt, 'merchant' | 'purchaseDate' | 'total' | 'currency'>): boolean {
  const normalize = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return receipts.some(r => normalize(r.merchant) === normalize(candidate.merchant) &&
    r.purchaseDate === candidate.purchaseDate && r.currency === candidate.currency &&
    Math.round(r.total * 100) === Math.round(candidate.total * 100));
}
