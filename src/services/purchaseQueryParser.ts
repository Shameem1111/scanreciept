import { Category } from '../types';
import { isSensitivePaymentText } from './privacy';
import { parseQueryDates } from './purchaseQueryDates';
import { PurchaseIntent, PurchaseQuery, QueryParseResult } from './purchaseQueryTypes';

export const queryGuidance = 'Ask naturally about your saved purchases, for example “How much did I spend on food in August 2026?”, “Where did I buy milk?”, “Show purchases at REWE”, “Find receipt for milk”, “Price history for milk”, “Cheapest milk” or “When did I last buy milk?”. German questions are supported too.';

export function normalizeQueryText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
}

const categoryAliases: [Category, string][] = [
  ['Food', 'food|groceries|lebensmittel'], ['Medicine', 'medicine|medicines|medication|medikamente|medizin|arzneimittel'],
  ['Clothing', 'clothing|clothes|kleidung'], ['Household', 'household|haushalt'], ['Electronics', 'electronics|elektronik'],
  ['Transport', 'transport|verkehr'], ['Restaurant', 'restaurant|restaurants'], ['Travel', 'travel|reisen'],
  ['Personal Care', 'personal care|koerperpflege'], ['Entertainment', 'entertainment|unterhaltung'], ['Other', 'other|sonstiges'],
];

export function parsePurchaseQuery(question: string, now = new Date()): QueryParseResult {
  const fail = (guidance = queryGuidance): QueryParseResult => ({ guidance });
  if (isSensitivePaymentText(question)) return fail('Payment and banking information is excluded. Ask about purchased products, merchants, categories or dates.');
  if (!question.trim() || question.length > 500) return fail();
  let text = normalizeQueryText(question).replace(/[?!]/g, '');
  let quotedProduct: string | undefined;
  let quotedCount = 0;
  text = text.replace(/["“]([^"”]+)["”]/g, (_, value: string) => {
    quotedCount++;
    quotedProduct = value;
    return ' ';
  });
  if (quotedCount > 1 || /["“”]/.test(text)) return fail('Please specify one product at a time, with matching double quotes.');
  if (/\b(?:not|except|excluding|without|nicht|ausser|ohne|versus|vs|compare|vergleich|or|oder)\b/.test(text)) return fail('Please ask for one purchase query with positive filters at a time. ' + queryGuidance);
  const candidates: PurchaseIntent[] = [];
  if (/\b(?:how much|total|sum|spent|spend|cost|costs|wie viel|wieviel|summe|ausgegeben|ausgaben|gekostet|kostet)\b/.test(text)) candidates.push('sum');
  if (/\b(?:price history|price trend|preisverlauf|preisentwicklung)\b/.test(text)) candidates.push('price_history');
  if (/\b(?:cheapest|lowest price|guenstigste\w*|billigste\w*)\b/.test(text)) candidates.push('cheapest');
  const naturalLatestPurchase = /\b(?:last|latest)\b/.test(text) && /\b(?:buy|bought|purchase|purchased|did|when)\b/.test(text);
  const naturalLatestPurchaseDe = /\b(?:zuletzt|letzte[rns]?)\b/.test(text) && /\b(?:gekauft|kauf|einkauf|wann)\b/.test(text);
  if (/\b(?:last purchase|latest purchase|last buy|last bought|zuletzt|letzte[rns]? kauf|letzten einkauf)\b/.test(text) || naturalLatestPurchase || naturalLatestPurchaseDe) candidates.push('last_purchase');
  if (/\b(?:receipt|receipts|beleg|belege|kassenbon|quittung)\b/.test(text)) candidates.push('find_receipt');
  if (candidates.length > 1) return fail('Please choose one action: total, list, receipt, price history, cheapest or last purchase.');
  const intent: PurchaseIntent = candidates[0] ?? 'list';

  const dates = parseQueryDates(text, now);
  if (dates.error) return fail(dates.error);
  text = dates.rest;
  if (intent !== 'last_purchase' && /\b(?:last|latest|letzte[rns]?)\b/.test(text)) return fail('For the latest purchase, ask “Last purchase of milk” / “Wann habe ich zuletzt Milch gekauft?”.');
  const query: PurchaseQuery = { intent, ...dates.filters };
  if (intent === 'cheapest' || intent === 'price_history' || intent === 'last_purchase') {
    text = text.replace(/\b(kauf|preisverlauf|preisentwicklung)\s+von\b/g, '$1 fuer');
  }
  const merchantPattern = /\b(?:at|bei|from|von)\s+(.+?)(?=\s+\b(?:at|bei|from|von|on|for|fuer|in|im|category|kategorie)\b|$)/g;
  let merchantCount = 0;
  text = text.replace(merchantPattern, (_, merchant: string) => {
    merchantCount++;
    query.merchant = merchant.replace(/\b(?:gekauft|ausgegeben|bitte|please)\b/g, '').trim();
    return ' ';
  });
  if (merchantCount > 1 || (merchantCount && (!query.merchant || /\b(?:and|und)\b/.test(query.merchant)))) return fail('Please specify one merchant, e.g. at REWE / bei REWE.');
  for (const [category, aliases] of categoryAliases) {
    const pattern = new RegExp(`\\b(?:${aliases})\\b`, 'g');
    if (pattern.test(text)) {
      if (query.category) return fail('Please choose one category per question.');
      query.category = category;
      text = text.replace(pattern, ' ');
    }
  }
  text = text.replace(/\b(?:price history|price trend|lowest price|last purchase|latest purchase|how much|wie viel|what did i buy|was habe ich)\b/g, ' ')
    .replace(/\b(?:show|list|find|the|my|me|all|purchases?|purchased|bought|buy|did|i|have|on|for|in|during|of|a|an|total|sum|spent|spend|cost|costs|what|when|where|last|latest|cheapest|receipt[s]?|please|category|about)\b/g, ' ')
    .replace(/\b(?:zeige|zeig|liste|finde|such|suche|mir|bitte|alle|meine|meinen|den|dem|der|die|das|ein|einen|ich|habe|hab|gekauft|kauf|einkaeufe|einkauf|fuer|im|in|am|wieviel|summe|ausgegeben|ausgaben|gekostet|kostet|was|wann|wo|welche|zuletzt|letzte[rns]?|guenstigste\w*|billigste\w*|preisverlauf|preisentwicklung|beleg|belege|kassenbon|quittung|kategorie)\b/g, ' ')
    .replace(/[.,:;]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/\b(?:and|und|to|bis|between|zwischen|from|von|at|bei|since|seit|month|monat)\b/.test(text)) return fail('Please make each filter explicit: product, at/bei merchant, category, and a date or month. ' + queryGuidance);
  if (quotedProduct && text) return fail('Please specify one product; put its complete name in double quotes.');
  if (quotedProduct || text) query.product = quotedProduct || text;
  if ([query.product, query.merchant].some(value => value !== undefined && !/[\p{L}\p{N}]/u.test(value))
    || (query.product && query.product.length > 160) || (query.merchant && query.merchant.length > 120)) return fail('Please use a short product or merchant name. ' + queryGuidance);
  if (['cheapest', 'price_history'].includes(intent) && !query.product) return fail('Which product? For example: “Cheapest milk” / “Preisverlauf für Milch”. Prices compare recorded line totals, with quantities shown.');
  return { query };
}
