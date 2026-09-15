import { Receipt } from '../types';
import { isSensitivePaymentText, redactSensitivePaymentText, sanitizeItemText, sanitizeMerchant } from './privacy';
import { reviewCategories, validPurchaseDate } from './receiptReview';
import { validMonth } from './purchaseQueryDates';
import { normalizeQueryText, parsePurchaseQuery, queryGuidance } from './purchaseQueryParser';
import { PurchaseEvidence, PurchaseQuery, PurchaseQueryResult } from './purchaseQueryTypes';

function tokens(value: string): string[] { return normalizeQueryText(value).match(/[\p{L}\p{N}]+/gu) ?? []; }
function matches(value: string, filter?: string): boolean {
  if (!filter) return true;
  const words = tokens(value);
  return tokens(filter).every(word => words.includes(word));
}
function formatDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
}
function money(centsValue: number): string { return `€${(centsValue / 100).toFixed(2)}`; }

export function cents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return Math.round(value * 100);
}
function validateQuery(query: PurchaseQuery): void {
  if (!['sum', 'list', 'find_receipt', 'price_history', 'cheapest', 'last_purchase'].includes(query.intent)
    || (query.category !== undefined && !reviewCategories.includes(query.category))
    || (query.fromDate !== undefined && !validPurchaseDate(query.fromDate))
    || (query.toDate !== undefined && !validPurchaseDate(query.toDate))
    || (query.month !== undefined && !validMonth(query.month))
    || (query.fromDate && query.toDate && query.fromDate > query.toDate)
    || [query.product, query.merchant].some(value => value !== undefined && (!tokens(value).length || isSensitivePaymentText(value)))
    || (query.product && query.product.length > 160) || (query.merchant && query.merchant.length > 120)
    || (['cheapest', 'price_history'].includes(query.intent) && !query.product)) {
    throw new Error('Invalid purchase query. Please specify an action and valid purchase filters.');
  }
}

/** Pure local execution. No network, SQL, storage writes or original-file dependency. */
export function executePurchaseQuery(query: PurchaseQuery, receipts: readonly Receipt[]): PurchaseQueryResult {
  validateQuery(query);
  query = { intent: query.intent, ...(query.product && { product: sanitizeItemText(query.product) }),
    ...(query.merchant && { merchant: sanitizeMerchant(query.merchant) }), ...(query.category && { category: query.category }),
    ...(query.fromDate && { fromDate: query.fromDate }), ...(query.toDate && { toDate: query.toDate }), ...(query.month && { month: query.month }) };
  const basis = query.intent === 'find_receipt' || (query.intent === 'sum' && !query.product && !query.category) ? 'receipt' : 'line';
  let rows: PurchaseEvidence[] = [];
  for (const receipt of receipts) {
    const date = validPurchaseDate(receipt.purchaseDate);
    if (!date || isSensitivePaymentText(receipt.merchant) || !matches(receipt.merchant, query.merchant)
      || (query.fromDate && date < query.fromDate) || (query.toDate && date > query.toDate)
      || (query.month && !date.startsWith(query.month + '-'))) continue;
    const items = receipt.items.filter(item => !isSensitivePaymentText(item.name) && !isSensitivePaymentText(item.originalText)
      && (matches(item.name, query.product) || matches(item.originalText, query.product))
      && (!query.category || item.category === query.category) && reviewCategories.includes(item.category)
      && cents(item.price) !== null && Number.isFinite(item.quantity) && item.quantity > 0);
    const common = { receiptId: receipt.id, merchant: sanitizeMerchant(receipt.merchant), date };
    if (basis === 'receipt') {
      if ((query.product || query.category) && !items.length) continue;
      const priceCents = cents(receipt.total);
      if (priceCents !== null) rows.push({ ...common, name: 'Receipt total', priceCents, basis });
    } else {
      rows.push(...items.map(item => ({ ...common, name: sanitizeItemText(item.name), category: item.category,
        quantity: item.quantity, priceCents: cents(item.price)!, basis: 'line' as const })));
    }
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.receiptId.localeCompare(b.receiptId) || a.name.localeCompare(b.name));
  if (query.intent === 'cheapest' && rows.length) {
    const minimum = rows.reduce((min, row) => Math.min(min, row.priceCents), Infinity);
    rows = rows.filter(row => row.priceCents === minimum);
  } else if (query.intent === 'last_purchase' && rows.length) {
    const lastDate = rows[rows.length - 1]!.date;
    rows = rows.filter(row => row.date === lastDate);
  } else if (query.intent !== 'price_history') rows.reverse();
  return { query, rows, basis, totalCents: rows.reduce((sum, row) => sum + row.priceCents, 0) };
}

export function describePurchaseQuery(query: PurchaseQuery): string {
  return [query.product && `Product: ${query.product}`, query.merchant && `Merchant: ${query.merchant}`,
    query.category && `Category: ${query.category}`, query.month && `Month: ${query.month}`,
    query.fromDate && `From: ${query.fromDate}`, query.toDate && `Through: ${query.toDate}`].filter(Boolean).join(' · ') || 'All recorded purchases';
}

export function summarizePurchaseResult(result: PurchaseQueryResult): string {
  if (!result.rows.length) return 'I could not find a matching purchase in your saved receipts.';
  const { query, rows } = result;
  const first = rows[0]!;
  const subject = query.product ?? (query.category ? query.category.toLowerCase() : 'this');

  if (query.intent === 'last_purchase') {
    const merchants = [...new Set(rows.map(row => row.merchant))];
    const merchantText = merchants.length === 1 ? ` at ${merchants[0]}` : '';
    const amount = rows.reduce((sum, row) => sum + row.priceCents, 0);
    return `You last bought ${subject} on ${formatDate(first.date)}${merchantText}. The matching purchase total was ${money(amount)}.`;
  }
  if (query.intent === 'sum') {
    const period = query.month ? ` in ${query.month}` : query.fromDate || query.toDate ? ' in that period' : '';
    return `You spent ${money(result.totalCents)} on ${subject}${period}.`;
  }
  if (query.intent === 'cheapest') {
    return `The cheapest recorded ${query.product} purchase was ${money(first.priceCents)} at ${first.merchant} on ${formatDate(first.date)}.`;
  }
  if (query.intent === 'find_receipt') {
    return rows.length === 1
      ? `I found one matching receipt from ${first.merchant} on ${formatDate(first.date)}.`
      : `I found ${rows.length} matching receipts. The newest one is from ${first.merchant} on ${formatDate(first.date)}.`;
  }
  if (query.intent === 'price_history') {
    const oldest = rows[0]!;
    const newest = rows[rows.length - 1]!;
    return rows.length === 1
      ? `I found one recorded ${query.product} purchase: ${money(first.priceCents)} at ${first.merchant} on ${formatDate(first.date)}.`
      : `I found ${rows.length} recorded ${query.product} purchases. The price went from ${money(oldest.priceCents)} on ${formatDate(oldest.date)} to ${money(newest.priceCents)} on ${formatDate(newest.date)}.`;
  }
  if (rows.length === 1) {
    return `I found one matching purchase: ${first.name} for ${money(first.priceCents)} at ${first.merchant} on ${formatDate(first.date)}.`;
  }
  return `I found ${rows.length} matching purchases. The newest was ${first.name} for ${money(first.priceCents)} at ${first.merchant} on ${formatDate(first.date)}.`;
}

export function preparePurchaseQuestion(question: string, now = new Date()) {
  const parsed = parsePurchaseQuery(question, now);
  return { text: redactSensitivePaymentText(question).slice(0, 500), ...parsed };
}

export { queryGuidance };
