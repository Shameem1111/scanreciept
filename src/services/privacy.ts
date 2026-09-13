const sensitivePaymentPatterns: RegExp[] = [
  /\b(?:IBAN|BIC|SWIFT)\b/i,
  /\b(?:EC[- ]?KARTE|GIROCARD|MAESTRO|MASTERCARD|VISA|AMEX)\b/i,
  /\b(?:AUTH|AUTORISIERUNG|AUTHORIZATION|TERMINAL(?:\s*ID)?|TID|MID)\b/i,
  /\b(?:KARTENNR|CARD\s*NO|CARD\s*NUMBER|PAN)\b/i,
  /\bDE\d{2}(?:\s?\d{4}){4}\s?\d{2}\b/i,
  /(?:\d[ -]*?){13,19}/,
  /\*{2,}\s*\d{2,6}/,
];

export function isSensitivePaymentText(value: string): boolean {
  return sensitivePaymentPatterns.some((pattern) => pattern.test(value));
}

export function redactSensitivePaymentText(value: string): string {
  if (isSensitivePaymentText(value)) return '[PAYMENT INFORMATION REMOVED]';
  return value;
}

export function sanitizeMerchant(value: string): string {
  return redactSensitivePaymentText(value).slice(0, 120);
}

export function sanitizeItemText(value: string): string {
  return redactSensitivePaymentText(value).slice(0, 160);
}
