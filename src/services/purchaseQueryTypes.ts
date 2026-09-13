import { Category } from '../types';

export type PurchaseIntent = 'sum' | 'list' | 'find_receipt' | 'price_history' | 'cheapest' | 'last_purchase';
export type PurchaseQuery = {
  intent: PurchaseIntent;
  product?: string;
  merchant?: string;
  category?: Category;
  fromDate?: string;
  toDate?: string;
  /** Calendar month, YYYY-MM. Intersects any explicit date bounds. */
  month?: string;
};
export type QueryParseResult = { query: PurchaseQuery; guidance?: never } | { query?: never; guidance: string };
export type PurchaseEvidence = {
  receiptId: string;
  merchant: string;
  date: string;
  name: string;
  category?: Category;
  quantity?: number;
  priceCents: number;
  basis: 'receipt' | 'line';
};
export type PurchaseQueryResult = {
  query: PurchaseQuery;
  rows: PurchaseEvidence[];
  totalCents: number;
  basis: 'receipt' | 'line';
};
