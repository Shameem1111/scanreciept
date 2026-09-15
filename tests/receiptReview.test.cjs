const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function load(name) {
  const filename = path.resolve(__dirname, '../src/services', name + '.ts');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: load }, { filename });
  return exports;
}
const { createReviewDraft, validateReview, itemTotal, lowConfidence, reviewNumber } = load('receiptReview');
const { isSensitivePaymentText } = load('privacy');
const extraction = () => ({ merchant: 'REWE', purchaseDate: '2026-09-13', total: 3.50, currency: 'EUR', source: 'ai',
  items: [{ id: '1', originalText: 'BIO M?SLI gro?', name: 'M?sli', category: 'Food', quantity: 2, price: 3.50, confidence: .5 }] });
test('corrections, additions and removals preserve source text and printed total', () => {
  const source = extraction(); const draft = createReviewDraft(source);
  draft.items[0].name = 'Organic cereal'; draft.items[0].quantity = '3'; draft.items[0].price = '4,20';
  draft.items.push({ ...draft.items[0], id: '2', originalText: '', name: 'Milk', price: '1.10' });
  assert.equal(itemTotal(draft.items), 5.3);
  draft.total = String(itemTotal(draft.items));
  const saved = validateReview(draft).receipt;
  assert.equal(saved.items[0].originalText, source.items[0].originalText);
  assert.equal(source.items[0].name, 'M?sli');
  assert.equal(saved.total, 5.3); assert.equal(saved.printedTotal, 3.5);
  assert.equal(saved.items[1].originalText, '');
  draft.items.splice(0, 1); assert.equal(itemTotal(draft.items), 1.1);
  draft.items = []; assert.equal(validateReview(draft).receipt, null);
});
test('manual review remains auditable as manual data', () => {
  const draft = createReviewDraft({ ...extraction(), source: 'manual' });
  assert.equal(validateReview(draft).receipt.source, 'manual');
});
test('invalid dates, merchant, totals, quantity, price and category prevent save', () => {
  for (const patch of [{ merchant: '  ' }, { purchaseDate: '' }, { purchaseDate: '2026-02-30' }, { total: '-1' }, { total: 'Infinity' }, { total: '2.999' }]) {
    assert.equal(validateReview({ ...createReviewDraft(extraction()), ...patch }).receipt, null);
  }
  for (const patch of [{ name: '' }, { quantity: '0' }, { quantity: '-1' }, { quantity: '2oops' }, { price: '' }, { price: 'NaN' }, { category: 'Bank' }]) {
    const draft = createReviewDraft(extraction()); Object.assign(draft.items[0], patch);
    assert.equal(validateReview(draft).receipt, null);
  }
  const draft = createReviewDraft(extraction()); draft.purchaseDate = '2024-02-29';
  assert.ok(validateReview(draft).receipt);
});
test('low and missing confidence remain visible even after corrections', () => {
  for (const confidence of [undefined, NaN, -1, 0, .79, 2]) assert.equal(lowConfidence(confidence), true);
  assert.equal(lowConfidence(.8), false);
  const draft = createReviewDraft(extraction()); draft.items[0].name = 'Corrected';
  assert.equal(validateReview(draft).receipt.items[0].confidence, .5);
});
test('decimal parsing and line arithmetic are deterministic without multiplying quantity twice', () => {
  assert.equal(reviewNumber('1,23'), 1.23);
  for (const value of ['1e2', '1.234,56', '1,234.56', '12abc', 'Infinity', '1000001']) assert.equal(reviewNumber(value), null);
  const draft = createReviewDraft(extraction());
  draft.items = ['0.10', '0.20'].map(price => ({ ...draft.items[0], quantity: '3', price }));
  assert.equal(itemTotal(draft.items), .3);
});
test('edited payment data is rejected and source/payment extras cannot enter persisted purchase data', () => {
  for (const sensitive of ['VISA **1234', 'xxxx 1234', 'IBAN FR1420041010050500013M02606', 'Bank account 123456', 'Terminal 123', 'Authorization ABC123', 'Payment reference ABC-999', 'CVV 123', 'Card expiry 09/28', 'KONTONUMMER 123456']) {
    assert.equal(isSensitivePaymentText(sensitive), true);
    const draft = createReviewDraft(extraction()); draft.merchant = sensitive;
    assert.equal(validateReview(draft).receipt, null);
    draft.merchant = 'Shop'; draft.items[0].name = sensitive;
    assert.equal(validateReview(draft).receipt, null);
    draft.items[0].name = 'Milk'; draft.items[0].originalText = sensitive;
    draft.paymentReference = sensitive; draft.items[0].bank = sensitive;
    const saved = validateReview(draft).receipt;
    assert.equal(JSON.stringify(saved).includes(sensitive), false);
    assert.equal('paymentReference' in saved, false); assert.equal('bank' in saved.items[0], false);
  }
  const draft = createReviewDraft(extraction()); draft.merchant = '  Shop\n  Berlin  ';
  assert.equal(validateReview(draft).receipt.merchant, 'Shop Berlin');
});
