import { validPurchaseDate } from './receiptReview';
import { PurchaseQuery } from './purchaseQueryTypes';

const months = [
  ['january', 'januar'], ['february', 'februar'], ['march', 'maerz'], ['april'], ['may', 'mai'], ['june', 'juni'],
  ['july', 'juli'], ['august'], ['september'], ['october', 'oktober'], ['november'], ['december', 'dezember'],
];
const datePattern = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.\\d{1,2}\\.\\d{4})';
function isoDate(value: string): string {
  const parts = value.split('.');
  return validPurchaseDate(parts.length === 3 ? `${parts[2]}-${parts[1]!.padStart(2, '0')}-${parts[0]!.padStart(2, '0')}` : value);
}
export function validMonth(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }

export function parseQueryDates(input: string, now: Date): {
  rest: string; filters: Pick<PurchaseQuery, 'fromDate' | 'toDate' | 'month'>; error?: string;
} {
  let rest = input;
  const filters: Pick<PurchaseQuery, 'fromDate' | 'toDate' | 'month'> = {};
  let error: string | undefined;
  const dateError = 'Use a valid date or inclusive range, e.g. from 2026-08-01 to 2026-08-31 / vom 01.08.2026 bis 31.08.2026.';
  const range = new RegExp(`\\b(?:from|between|von|vom|zwischen)\\s+(${datePattern})\\s+(?:to|and|bis|und)\\s+(${datePattern})\\b`, 'g');
  rest = rest.replace(range, (_, from: string, to: string) => {
    if (filters.fromDate || filters.toDate) error = dateError;
    filters.fromDate = isoDate(from); filters.toDate = isoDate(to);
    if (!filters.fromDate || !filters.toDate || filters.fromDate > filters.toDate) error = dateError;
    return ' ';
  });
  rest = rest.replace(new RegExp(`\\b(on|am|since|seit|from|ab|until|through|bis)\\s+(${datePattern})\\b`, 'g'), (_, prep: string, date: string) => {
    const value = isoDate(date);
    if (!value) error = dateError;
    if (['on', 'am'].includes(prep)) {
      if (filters.fromDate || filters.toDate) error = dateError;
      filters.fromDate = value; filters.toDate = value;
    } else if (['until', 'through', 'bis'].includes(prep)) {
      if (filters.toDate) error = dateError;
      filters.toDate = value;
    } else {
      if (filters.fromDate) error = dateError;
      filters.fromDate = value;
    }
    return ' ';
  });
  const setMonth = (value: string) => {
    if (filters.month || !validMonth(value)) error = 'Please specify one calendar month, e.g. August 2026 / August 2026.';
    filters.month = value;
    return ' ';
  };
  rest = rest.replace(/\b(?:this month|diesen monat|diesem monat|last month|letzten monat|letztem monat)\b/g, value => {
    const date = new Date(now.getFullYear(), now.getMonth() - (/last|letzt/.test(value) ? 1 : 0), 1);
    return setMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  });
  const monthNames = months.flat().join('|');
  rest = rest.replace(new RegExp(`\\b(${monthNames})(?:\\s+(\\d{4}))?\\b`, 'g'), (_, name: string, year?: string) =>
    setMonth(`${year ?? now.getFullYear()}-${String(months.findIndex(names => names.includes(name)) + 1).padStart(2, '0')}`));
  rest = rest.replace(/\b\d{4}-\d{2}\b(?!-\d)/g, value => setMonth(value));
  if (filters.fromDate && filters.toDate && filters.fromDate > filters.toDate) error = dateError;
  // Never silently drop an unrecognised time condition and answer over all history.
  if (/\b(?:today|yesterday|week|year|heute|gestern|woche|jahr|before|after|vor|nach)\b|\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\b(?:19|20)\d{2}\b/.test(rest)) error = dateError;
  return { rest, filters, error };
}
