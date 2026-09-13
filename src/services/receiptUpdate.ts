import { Receipt } from '../types';
import { ReviewDraft, validateReview } from './receiptReview';
import { sanitizeItemText } from './privacy';

export function updateStructuredReceipt(receipts: Receipt[], id: string, draft: ReviewDraft): Receipt[] {
  const original = receipts.find(receipt => receipt.id === id);
  if (!original) throw new Error('Receipt no longer exists.');
  const checked = validateReview(draft);
  if (!checked.receipt) throw new Error('Correct the receipt fields before saving.');
  const updated: Receipt = {
    ...checked.receipt, id: original.id, createdAt: original.createdAt, source: original.source,
    printedTotal: original.printedTotal ?? original.total,
    storageProvider: original.storageProvider, storageReference: original.storageReference,
    originalFilename: sanitizeItemText(original.originalFilename),
  };
  return receipts.map(receipt => receipt.id === id ? updated : receipt);
}
