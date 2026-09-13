import { Category, ExtractedReceipt } from '../types';
import { isSensitivePaymentText, sanitizeItemText, sanitizeMerchant } from './privacy';

export const reviewCategories: Category[] = ['Food', 'Medicine', 'Clothing', 'Household', 'Electronics', 'Transport', 'Restaurant', 'Travel', 'Personal Care', 'Entertainment', 'Other'];
export type ReviewItem = { id: string; readonly originalText: string; name: string; category: Category; quantity: string; price: string; confidence: number };
export type ReviewDraft = { merchant: string; purchaseDate: string; total: string; readonly printedTotal: number; source: ExtractedReceipt['source']; items: ReviewItem[] };

export function validPurchaseDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

export function lowConfidence(confidence?: number): boolean {
  return !Number.isFinite(confidence) || confidence! < 0.8 || confidence! > 1;
}

// Accept decimal commas, but reject ambiguous grouping, exponents and partial numbers.
export function reviewNumber(value: string, decimals = 2): number | null {
  const clean = value.trim();
  if (!new RegExp(`^\\d+(?:[.,]\\d{1,${decimals}})?$`).test(clean)) return null;
  const number = Number(clean.replace(',', '.'));
  return Number.isFinite(number) && number <= 1_000_000 ? number : null;
}

export function createReviewDraft(receipt: ExtractedReceipt): ReviewDraft {
  return {
    merchant: sanitizeMerchant(receipt.merchant), purchaseDate: validPurchaseDate(receipt.purchaseDate),
    total: String(receipt.total), printedTotal: receipt.printedTotal ?? receipt.total, source: receipt.source,
    items: receipt.items.map((item) => ({
      id: item.id, originalText: sanitizeItemText(item.originalText), name: sanitizeItemText(item.name),
      category: item.category, quantity: String(item.quantity), price: String(item.price), confidence: item.confidence,
    })),
  };
}

export function itemTotal(items: ReviewItem[]): number | null {
  let cents = 0;
  for (const item of items) {
    const price = reviewNumber(item.price);
    if (price === null) return null;
    cents += Math.round(price * 100);
  }
  return cents / 100;
}

export function validateReview(draft: ReviewDraft): { errors: Record<string, string>; receipt: ExtractedReceipt | null } {
  const errors: Record<string, string> = {};
  const merchant = sanitizeMerchant(draft.merchant);
  if (!merchant || merchant === 'Unknown merchant' || isSensitivePaymentText(draft.merchant) || merchant === '[PAYMENT INFORMATION REMOVED]') errors.merchant = 'Enter a merchant without payment information.';
  const purchaseDate = validPurchaseDate(draft.purchaseDate.trim());
  if (!purchaseDate) errors.purchaseDate = 'Enter a real purchase date (YYYY-MM-DD).';
  const total = reviewNumber(draft.total);
  if (total === null) errors.total = 'Enter a non-negative EUR amount with at most two decimals.';
  if (!draft.items.length) errors.items = 'Add at least one purchased item.';
  const items = draft.items.map((item, index) => {
    const name = sanitizeItemText(item.name);
    const quantity = reviewNumber(item.quantity, 3);
    const price = reviewNumber(item.price);
    if (!name || isSensitivePaymentText(item.name) || name === '[PAYMENT INFORMATION REMOVED]') errors[`${index}.name`] = 'Enter an item name without payment information.';
    if (quantity === null || quantity <= 0) errors[`${index}.quantity`] = 'Enter a quantity greater than zero (up to three decimals).';
    if (price === null) errors[`${index}.price`] = 'Enter a non-negative line total with at most two decimals.';
    if (!reviewCategories.includes(item.category)) errors[`${index}.category`] = 'Choose a category.';
    return { id: `item-${index + 1}`, originalText: sanitizeItemText(item.originalText), name, category: item.category,
      quantity: quantity ?? 0, price: price ?? 0, confidence: Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0 };
  });
  return { errors, receipt: Object.keys(errors).length ? null : {
    merchant, purchaseDate, total: total!, currency: 'EUR', source: draft.source === 'demo' ? 'demo' : 'ai', items,
    ...(Number.isFinite(draft.printedTotal) && draft.printedTotal >= 0 ? { printedTotal: draft.printedTotal } : {}),
  } };
}
