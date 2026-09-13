const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const cache = {};
function load(name) {
  const filename = path.resolve(__dirname, '../src/services', name + '.ts');
  if (cache[filename]) return cache[filename];
  const exports = cache[filename] = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: load }, { filename });
  return exports;
}
const { parsePurchaseQuery } = load('purchaseQueryParser');
const { executePurchaseQuery, preparePurchaseQuestion, describePurchaseQuery, summarizePurchaseResult } = load('purchaseQuery');
const now = new Date(2026, 8, 13, 12);
const plain = value => JSON.parse(JSON.stringify(value));
const parse = text => parsePurchaseQuery(text, now);
const cases = [
  ['How much did I spend on food in August 2026?', { intent: 'sum', category: 'Food', month: '2026-08' }],
  ['Wie viel habe ich für Lebensmittel im August 2026 ausgegeben?', { intent: 'sum', category: 'Food', month: '2026-08' }],
  ['Show purchases from REWE', { intent: 'list', merchant: 'rewe' }],
  ['Zeige Einkäufe bei REWE', { intent: 'list', merchant: 'rewe' }],
  ['What medicines did I buy?', { intent: 'list', category: 'Medicine' }],
  ['Welche Medikamente habe ich gekauft?', { intent: 'list', category: 'Medicine' }],
  ['Find receipt for milk', { intent: 'find_receipt', product: 'milk' }],
  ['Finde den Beleg für Milch', { intent: 'find_receipt', product: 'milch' }],
  ['Show receipts from REWE in September 2026', { intent: 'find_receipt', merchant: 'rewe', month: '2026-09' }],
  ['Price history for milk', { intent: 'price_history', product: 'milk' }],
  ['Preisverlauf für Milch', { intent: 'price_history', product: 'milch' }],
  ['Preisentwicklung von Milch', { intent: 'price_history', product: 'milch' }],
  ['Where did I buy milk cheapest?', { intent: 'cheapest', product: 'milk' }],
  ['Günstigster Kauf von Milch', { intent: 'cheapest', product: 'milch' }],
  ['Wo habe ich Milch am günstigsten gekauft?', { intent: 'cheapest', product: 'milch' }],
  ['When did I last buy milk?', { intent: 'last_purchase', product: 'milk' }],
  ['Wann habe ich zuletzt Milch gekauft?', { intent: 'last_purchase', product: 'milch' }],
  ['Last purchase', { intent: 'last_purchase' }],
  ['Total spent at REWE on milk in August 2026', { intent: 'sum', merchant: 'rewe', product: 'milk', month: '2026-08' }],
  ['Wie viel habe ich für Milch bei REWE ausgegeben?', { intent: 'sum', product: 'milch', merchant: 'rewe' }],
  ['List "Personal care gift set" at dm', { intent: 'list', product: 'personal care gift set', merchant: 'dm' }],
  ['Show Müsli', { intent: 'list', product: 'muesli' }],
  ['Show "receipt paper"', { intent: 'list', product: 'receipt paper' }],
  ['Find receipt for "Total cereal"', { intent: 'find_receipt', product: 'total cereal' }],
];
for (const [question, expected] of cases) test('parse: ' + question, () => assert.deepEqual(plain(parse(question).query), expected));

test('all category identifiers have German aliases', () => {
  for (const [name, category] of Object.entries({ Lebensmittel: 'Food', Medikamente: 'Medicine', Kleidung: 'Clothing', Haushalt: 'Household', Elektronik: 'Electronics', Verkehr: 'Transport', Restaurant: 'Restaurant', Reisen: 'Travel', Körperpflege: 'Personal Care', Unterhaltung: 'Entertainment', Sonstiges: 'Other' })) {
    assert.equal(parse(`Zeige ${name}`).query.category, category);
  }
});
test('inclusive ranges, exact dates and open bounds in both languages', () => {
  for (const suffix of ['from 2026-08-01 to 2026-08-31', 'between 2026-08-01 and 2026-08-31', 'vom 1.8.2026 bis 31.8.2026', 'zwischen 01.08.2026 und 31.08.2026']) {
    assert.deepEqual(plain(parse('Show milk ' + suffix).query), { intent: 'list', product: 'milk', fromDate: '2026-08-01', toDate: '2026-08-31' });
  }
  assert.deepEqual(plain(parse('Show milk am 29.02.2024').query), { intent: 'list', product: 'milk', fromDate: '2024-02-29', toDate: '2024-02-29' });
  assert.equal(parse('Show milk since 2026-08-01').query.fromDate, '2026-08-01');
  assert.equal(parse('Zeige Milch bis 31.08.2026').query.toDate, '2026-08-31');
});
test('calendar month names, current-year assumption, relative months and year rollover', () => {
  for (const month of ['March', 'März', 'Maerz']) assert.equal(parse('List milk in ' + month).query.month, '2026-03');
  assert.equal(parse('Show milk in 2026-02').query.month, '2026-02');
  assert.equal(parse('Show milk this month').query.month, '2026-09');
  assert.equal(parse('Zeige Milch letzten Monat').query.month, '2026-08');
  assert.equal(parsePurchaseQuery('Show milk last month', new Date(2026, 0, 1)).query.month, '2025-12');
  assert.match(describePurchaseQuery(parse('Show milk in August').query), /2026-08/);
});
test('ambiguous and unsupported questions never become unfiltered totals', () => {
  for (const question of ['', 'What is the weather?', 'How much did I spend last week?', 'Total yesterday', 'Total in 2025',
    'Show milk on 2026-02-30', 'Show milk on 02/03/2026', 'Total from 2026-09-01 to 2026-08-01',
    'Total in August and September', 'Total in 2026-13', 'Cheapest purchase', 'Price history',
    'Show food and medicine', 'Show purchases except food', 'Total or cheapest milk', 'Show milk and bread',
    'Show milk before 2026-08-01', 'Compare milk prices', 'Show milk at REWE at Aldi']) {
    assert.ok(parse(question).guidance, question);
    assert.equal(parse(question).query, undefined, question);
  }
});
function receipt(id, date, total, items, merchant = 'REWE') {
  return { id, purchaseDate: date, merchant, total, currency: 'EUR', source: 'ai', createdAt: date,
    storageProvider: 'local', storageReference: '', originalFilename: 'missing.pdf',
    items: items.map(([name, price, category = 'Food', quantity = 1], i) => ({ id: String(i), name,
      originalText: name === 'Milk' ? 'MILCH' : name, price, category, quantity, confidence: 1 })) };
}
const receipts = [
  receipt('sep', '2026-09-01', 8, [['Milk', 3, 'Food', 2], ['Soap', 5, 'Household']], 'Aldi'),
  receipt('aug-end', '2026-08-31', 4, [['Milk', 2], ['Bread', 2]]),
  receipt('aug-start', '2026-08-01', 7, [['Milk', 2], ['Medicine', 5, 'Medicine']]),
  receipt('old', '2025-08-01', 1, [['Milk', 1]], 'Lidl'),
  receipt('july', '2026-07-31', 4, [['Milk', 4]]),
];
const run = query => executePurchaseQuery(query, receipts);
test('sum uses receipt totals once, item filters use matching line totals without multiplying quantity', () => {
  assert.equal(run({ intent: 'sum', month: '2026-08' }).totalCents, 1100);
  assert.equal(run({ intent: 'sum', category: 'Food', month: '2026-08' }).totalCents, 600);
  const result = run({ intent: 'sum', product: 'Milk', month: '2026-09' });
  assert.equal(result.totalCents, 300); assert.equal(result.rows[0].quantity, 2);
  const discounted = [receipt('discount', '2026-08-01', 1.5, [['Milk', 2]])];
  assert.equal(executePurchaseQuery({ intent: 'sum' }, discounted).totalCents, 150);
  assert.equal(executePurchaseQuery({ intent: 'sum', product: 'Milk' }, discounted).totalCents, 200);
  const fractions = [receipt('cents', '2026-08-01', .3, [['Milk', .1], ['Milk', .2]])];
  assert.equal(executePurchaseQuery({ intent: 'sum', product: 'Milk' }, fractions).totalCents, 30);
});
test('date endpoints are inclusive, month includes year, filters intersect and invalid dates are skipped', () => {
  const query = { intent: 'list', product: 'Milk', fromDate: '2026-08-01', toDate: '2026-08-31' };
  assert.deepEqual(plain(run(query).rows.map(r => r.receiptId)), ['aug-end', 'aug-start']);
  assert.equal(run({ ...query, month: '2026-09' }).rows.length, 0);
  assert.equal(run({ intent: 'list', fromDate: '2026-09-01' }).rows.length, 2);
  assert.equal(run({ intent: 'list', toDate: '2025-08-01' }).rows.length, 1);
  assert.equal(run({ intent: 'list', product: 'Milk', merchant: 'aldi', category: 'Food', month: '2026-09' }).rows.length, 1);
  assert.equal(executePurchaseQuery({ intent: 'list' }, [receipt('bad', '2026-02-30', 1, [['Milk', 1]])]).rows.length, 0);
});
test('cheapest applies filters before comparing integer cents and preserves all ties with provenance', () => {
  const result = run({ intent: 'cheapest', product: 'Milk', month: '2026-08' });
  assert.deepEqual(plain(result.rows.map(r => r.receiptId)), ['aug-start', 'aug-end']);
  for (const row of result.rows) { assert.equal(row.priceCents, 200); assert.equal(row.merchant, 'REWE'); assert.ok(row.date); }
  assert.equal(run({ intent: 'cheapest', product: 'Milk' }).rows[0].receiptId, 'old');
  assert.match(summarizePurchaseResult(result), /not unit prices/);
});
test('price history is chronological, retains repetitions and quantities, and never mutates input', () => {
  const before = JSON.stringify(receipts);
  const result = run({ intent: 'price_history', product: 'milch' });
  assert.deepEqual(plain(result.rows.map(r => r.receiptId)), ['old', 'july', 'aug-start', 'aug-end', 'sep']);
  assert.deepEqual(plain(result.rows.map(r => r.priceCents)), [100, 400, 200, 200, 300]);
  assert.equal(result.rows.at(-1).quantity, 2);
  assert.equal(JSON.stringify(receipts), before);
});
test('last purchase is based on purchase date, with ties on the latest date', () => {
  const result = run({ intent: 'last_purchase', product: 'Milk', merchant: 'REWE' });
  assert.equal(result.rows[0].receiptId, 'aug-end');
  const tied = [...receipts, receipt('same-day', '2026-09-01', 4, [['Milk', 4]])];
  assert.equal(executePurchaseQuery({ intent: 'last_purchase', product: 'Milk' }, tied).rows.length, 2);
});
test('find receipt deduplicates multiple matching lines and keeps links despite missing originals', () => {
  const result = executePurchaseQuery({ intent: 'find_receipt', product: 'Milk' }, [receipt('proof', '2026-08-01', 5, [['Milk', 2], ['Milk', 3]])]);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].receiptId, 'proof'); assert.equal(result.rows[0].priceCents, 500);
  assert.equal(result.rows[0].basis, 'receipt');
});
test('matching handles original text, umlauts and word boundaries without matching unrelated substrings', () => {
  assert.equal(run({ intent: 'list', product: 'milch' }).rows.length, 5);
  const input = [receipt('text', '2026-08-01', 6, [['Müsli', 2], ['Shampoo', 2], ['Ham', 2]])];
  assert.equal(executePurchaseQuery({ intent: 'list', product: 'muesli' }, input).rows.length, 1);
  assert.equal(executePurchaseQuery({ intent: 'list', product: 'ham' }, input).rows.length, 1);
});
test('invalid typed queries are rejected, empty results provide useful guidance', () => {
  for (const query of [{ intent: 'sql' }, { intent: 'sum', month: '2026-13' }, { intent: 'sum', fromDate: '2026-02-30' },
    { intent: 'sum', category: 'Bank' }, { intent: 'sum', product: '' }, { intent: 'cheapest' }]) assert.throws(() => run(query), /Invalid purchase query/);
  assert.equal(executePurchaseQuery({ intent: 'sum' }, []).totalCents, 0);
  assert.match(summarizePurchaseResult(run({ intent: 'list', product: 'missing' })), /wider date range/);
});
test('payment information never enters chat history or evidence, including malicious legacy fields', () => {
  for (const secret of ['VISA **1234', 'IBAN DE89370400440532013000', 'Terminal 123', 'Bank account 123456', 'CVV 123']) {
    const prepared = preparePurchaseQuestion('Show ' + secret, now);
    assert.equal(prepared.query, undefined); assert.equal(prepared.text, '[PAYMENT INFORMATION REMOVED]');
    assert.equal(JSON.stringify(prepared).includes(secret), false);
    assert.throws(() => run({ intent: 'list', product: secret }), /Invalid/);
    const unsafe = receipt('unsafe', '2026-08-01', 4, [[secret, 2], ['Milk', 2]]);
    unsafe.items[1].paymentReference = secret;
    const result = executePurchaseQuery({ intent: 'list' }, [unsafe]);
    assert.equal(result.rows.length, 1); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('unsupported last-receipt shortcuts, malformed product filters and multi-product quotes get guidance', () => {
  for (const question of ['Find my last receipt', 'Show ---', 'Show milk at ---', 'Show "milk" and "bread" and "soap"', 'Show "milk']) {
    assert.ok(parse(question).guidance, question);
  }
});
test('query results strip injected fields and exclude unsafe merchant and source text', () => {
  const secret = 'VISA **1234';
  const unsafeMerchant = receipt('unsafe-merchant', '2026-08-01', 2, [['Milk', 2]], secret);
  const unsafeSource = receipt('unsafe-source', '2026-08-01', 2, [['Milk', 2]]);
  unsafeSource.items[0].originalText = secret;
  const result = executePurchaseQuery({ intent: 'list', paymentReference: secret }, [...receipts, unsafeMerchant, unsafeSource]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.rows.some(row => row.receiptId.startsWith('unsafe')), false);
  assert.deepEqual(plain(result.query), { intent: 'list' });
});
test('leap-day and month-end execution preserves calendar boundaries', () => {
  const input = ['2024-02-28', '2024-02-29', '2024-03-01'].map(date => receipt(date, date, 1, [['Milk', 1]]));
  assert.equal(executePurchaseQuery({ intent: 'sum', month: '2024-02' }, input).totalCents, 200);
  assert.equal(executePurchaseQuery({ intent: 'sum', fromDate: '2024-02-29', toDate: '2024-02-29' }, input).totalCents, 100);
});
test('Ask renders evidence, opens the correct receipt, and recalculates after structured edits', () => {
  const hookStates = new Map(); let current; let cursor;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    useState: initial => {
      const index = cursor++;
      if (!(index in current)) current[index] = initial;
      const values = current;
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
    }, useMemo: compute => compute(),
  };
  let saved = receipts;
  const mocks = {
    react: { ...react, default: react },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: x => x },
      ...Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'Pressable', 'SafeAreaView', 'ScrollView', 'Text', 'TextInput', 'View'].map(x => [x, x])) },
    '../components/Ui': { SecondaryButton: 'SecondaryButton' },
    '../store/ReceiptStore': { useReceiptStore: () => ({ receipts: saved, hydrated: true }) },
    '../theme': { colors: {} }, './ReceiptDetailScreen': { ReceiptDetailScreen: 'ReceiptDetailScreen' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/screens/AskScreen.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: name => mocks[name] ?? load(path.basename(name)) });
  function render(component, props = {}) {
    if (!hookStates.has(component)) hookStates.set(component, []);
    current = hookStates.get(component); cursor = 0;
    return component(props);
  }
  function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.props?.children ?? []).flatMap(nodes)] : []; }
  let tree = render(exports.AskScreen);
  nodes(tree).find(n => n.type === 'TextInput').props.onChangeText('Price history for milk');
  tree = render(exports.AskScreen);
  nodes(tree).find(n => n.props.accessibilityLabel === 'Send question').props.onPress();
  tree = render(exports.AskScreen);
  const answer = nodes(tree).find(n => typeof n.type === 'function' && n.props.query);
  let evidence = render(answer.type, answer.props);
  const links = nodes(evidence).filter(n => n.type === 'Pressable');
  assert.equal(links.length, 5);
  assert.match(links[0].props.accessibilityLabel, /Lidl, 2025-08-01/);
  links[0].props.onPress();
  tree = render(exports.AskScreen);
  const detail = nodes(tree).find(n => n.type === 'ReceiptDetailScreen');
  assert.equal(detail.props.receiptId, 'old'); assert.equal(detail.props.backLabel, 'Back to Ask');
  detail.props.onBack();
  saved = receipts.filter(r => r.id !== 'old');
  evidence = render(answer.type, answer.props);
  assert.equal(nodes(evidence).filter(n => n.type === 'Pressable').length, 4);
  tree = render(exports.AskScreen);
  assert.equal(nodes(tree).find(n => n.type === 'Modal').props.visible, false);
});
