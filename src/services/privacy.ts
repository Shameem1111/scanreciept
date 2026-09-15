const sensitivePaymentPatterns: RegExp[] = [
  /\b(?:IBAN|BIC|SWIFT|CVV|CVC|BANK|BANKING|KONTO|KONTONUMMER|ACCOUNT|EXPIRY|EXPIRATION|G\u00dcLTIG)\b/i,
  /\b(?:EC[- ]?KARTE|GIROCARD|MAESTRO|MASTERCARD|VISA|AMEX)\b/i,
  /\b(?:AUTH|AUTORISIERUNG|AUTORISATION|AUTHORIZATION|AUTHORISATION|PAYMENT[ -]?REFERENCE|ZAHLUNGSREFERENZ|REFERENZ|TRACE|TRANSACTION[ -]?ID|TERMINAL(?:\s*ID)?|TID|MID)\b/i,
  /\b(?:KARTENNR|KARTENNUMMER|CARD|PAN)\b/i,
  /\bDE\d{2}(?:\s?\d{4}){4}\s?\d{2}\b/i,
  /(?:\d[ -]*?){13,19}/,
  /[*xX\u2022]{2,}[ -]*\d{2,6}/,
  /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]){11,30}\b/i,
];

export function isSensitivePaymentText(value: string): boolean {
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
  return sensitivePaymentPatterns.some((pattern) => pattern.test(value) || pattern.test(normalized));
}

export function redactSensitivePaymentText(value: string): string {
  if (isSensitivePaymentText(value)) return '[PAYMENT INFORMATION REMOVED]';
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sanitizeMerchant(value: string): string {
  return redactSensitivePaymentText(value).slice(0, 120);
}

export function sanitizeItemText(value: string): string {
  return redactSensitivePaymentText(value).slice(0, 160);
}

// Only the sales receipt number belongs here, never identifiers from the payment slip.
export function sanitizeReceiptNumber(value: unknown): string {
  if (typeof value !== 'string') return '';
  const clean = value.normalize('NFKC').trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ./_-]{0,63}$/u.test(clean) ||
      isSensitivePaymentText(clean) || /\b(?:TA[- ]?NR|BNR|VU[- ]?NR|GENEHMIGUNGS[- ]?NR|EMV|AID)\b/i.test(clean)) return '';
  return clean;
}
