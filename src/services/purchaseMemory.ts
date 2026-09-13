import { Category, Receipt } from '../types';
import { cents } from './purchaseQuery';
import { normalizeQueryText } from './purchaseQueryParser';
import { isSensitivePaymentText } from './privacy';
import { reviewCategories, validPurchaseDate } from './receiptReview';

export type PurchaseSort = 'newest' | 'oldest' | 'lowest' | 'highest';
export type PurchaseGrouping = 'receipt' | 'product';
export type PurchaseFilters = { search?: string; merchant?: string; category?: Category; fromDate?: string; toDate?: string };
export type PurchaseRow = {
  key: string; receiptId: string; productKey: string; name: string; originalText: string;
  merchant: string; date: string; category: Category; quantity: number; priceCents: number;
};

// Identity is intentionally stricter than search: no inferred aliases or package equivalence.
export const productKey = (name: string) => name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function purchaseRows(receipts: readonly Receipt[]): PurchaseRow[] {
  return receipts.flatMap(receipt => {
    if (!validPurchaseDate(receipt.purchaseDate) || isSensitivePaymentText(receipt.merchant)) return [];
    return receipt.items.flatMap((item, index) => {
      const priceCents = cents(item.price);
      if (priceCents === null || !Number.isFinite(item.quantity) || item.quantity <= 0
        || !item.name.trim() || !reviewCategories.includes(item.category)
        || isSensitivePaymentText(item.name) || isSensitivePaymentText(item.originalText)) return [];
      return [{ key: JSON.stringify([receipt.id, item.id, index]), receiptId: receipt.id,
        productKey: productKey(item.name), name: item.name, originalText: item.originalText,
        merchant: receipt.merchant, date: receipt.purchaseDate, category: item.category, quantity: item.quantity, priceCents }];
    });
  });
}

export function dateRangeError(filters: PurchaseFilters): string | undefined {
  if ((filters.fromDate && !validPurchaseDate(filters.fromDate)) || (filters.toDate && !validPurchaseDate(filters.toDate)))
    return 'Enter real dates as YYYY-MM-DD.';
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) return 'From date must be on or before through date.';
}

export function filterPurchases(rows: readonly PurchaseRow[], filters: PurchaseFilters): PurchaseRow[] {
  if (dateRangeError(filters)) return [];
  const search = normalizeQueryText(filters.search ?? '');
  return rows.filter(row => (!search || normalizeQueryText(`${row.name} ${row.originalText} ${row.merchant} ${row.category}`).includes(search))
    && (!filters.merchant || productKey(row.merchant) === productKey(filters.merchant))
    && (!filters.category || row.category === filters.category)
    && (!filters.fromDate || row.date >= filters.fromDate) && (!filters.toDate || row.date <= filters.toDate));
}

export function sortPurchases(rows: readonly PurchaseRow[], sort: PurchaseSort): PurchaseRow[] {
  return [...rows].sort((a, b) => {
    const primary = sort === 'lowest' ? a.priceCents - b.priceCents : sort === 'highest' ? b.priceCents - a.priceCents
      : sort === 'oldest' ? compareText(a.date, b.date) : compareText(b.date, a.date);
    return primary || compareText(a.date, b.date) || compareText(a.key, b.key);
  });
}

/** Groups follow the first matching row in the requested sort; rows keep that sort within each group. */
export function groupPurchases(rows: readonly PurchaseRow[], grouping: PurchaseGrouping) {
  const groups = new Map<string, { key: string; title: string; rows: PurchaseRow[] }>();
  for (const row of rows) {
    const key = grouping === 'receipt' ? row.receiptId : row.productKey;
    if (!groups.has(key)) groups.set(key, { key, title: grouping === 'receipt' ? `${row.merchant} · ${row.date}` : row.name, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}

/** Full saved history, independent of browse filters. Same-day purchases are not known to be earlier. */
export function productPriceHistory(rows: readonly PurchaseRow[], selected: PurchaseRow) {
  const history = sortPurchases(rows.filter(row => row.productKey === selected.productKey), 'oldest');
  const previous = history.filter(row => row.date < selected.date);
  const minimum = previous.reduce((min, row) => Math.min(min, row.priceCents), Infinity);
  return { history, cheapestPrevious: previous.filter(row => row.priceCents === minimum) };
}
