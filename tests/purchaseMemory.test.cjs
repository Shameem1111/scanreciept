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
const { purchaseRows, filterPurchases, sortPurchases, groupPurchases, productPriceHistory, dateRangeError } = load('purchaseMemory');
const plain = value => JSON.parse(JSON.stringify(value));
function receipt(id, date, merchant, items) {
  return { id, purchaseDate: date, merchant, currency: 'EUR', total: 20, storageReference: '', items: items.map(([name, price, quantity = 1, category = 'Food', originalText = 'MILCH'], index) => ({
    id: `item-${index}`, name, originalText, price, quantity, category, confidence: 1,
  })) };
}
const receipts = [
  receipt('latest', '2026-09-13', 'REWE', [['Milk', 3, 2], ['Soap', 4, 1, 'Household', 'SEIFE']]),
  receipt('first', '2026-08-01', 'ALDI', [['Milk', 1.1], ['Milk chocolate', .5]]),
  receipt('end', '2026-08-31', 'REWE', [[' milk ', 1.1], ['Milk', 2]]),
  receipt('same-day', '2026-09-13', 'Lidl', [['Milk', .25]]),
  receipt('later', '2026-09-14', 'Lidl', [['Milk', 0]]),
];
const rows = purchaseRows(receipts);
const ids = values => plain(values.map(row => row.receiptId));

test('intersects merchant, item category, search and inclusive dates; open bounds and empty results', () => {
  assert.deepEqual(ids(filterPurchases(rows, { search: 'milch', merchant: 'rewe', category: 'Food', fromDate: '2026-08-31', toDate: '2026-09-13' })), ['latest', 'end', 'end']);
  assert.equal(filterPurchases(rows, { category: 'Household' }).length, 1);
  assert.equal(filterPurchases(rows, { fromDate: '2026-09-14' }).length, 1);
  assert.equal(filterPurchases(rows, { toDate: '2026-08-01' }).length, 2);
  assert.equal(filterPurchases(rows, { merchant: 'RE' }).length, 0);
  assert.equal(filterPurchases(rows, { search: 'unknown' }).length, 0);
  assert.equal(filterPurchases([], {}).length, 0);
  assert.equal(filterPurchases(purchaseRows([receipt('umlaut', '2026-01-01', 'Shop', [['Müsli', 2]])]), { search: 'muesli' }).length, 1);
});

test('invalid and reversed date ranges cannot silently broaden results, leap days validate', () => {
  for (const filters of [{ fromDate: '2026-02-29' }, { toDate: '2026-13-01' }, { fromDate: '2026-09-13', toDate: '2026-08-01' }, { fromDate: '2026-0' }]) {
    assert.ok(dateRangeError(filters)); assert.equal(filterPurchases(rows, filters).length, 0);
  }
  assert.equal(dateRangeError({ fromDate: '2024-02-29' }), undefined);
});

test('all four sorts order prices as cents and dates chronologically, with deterministic ties', () => {
  assert.equal(sortPurchases(rows, 'newest')[0].receiptId, 'later');
  assert.equal(sortPurchases(rows, 'oldest')[0].receiptId, 'first');
  assert.deepEqual(plain(sortPurchases(rows, 'lowest').map(row => row.priceCents)), [0, 25, 50, 110, 110, 200, 300, 400]);
  assert.deepEqual(plain(sortPurchases(rows, 'highest').map(row => row.priceCents)), [400, 300, 200, 110, 110, 50, 25, 0]);
  for (const sort of ['newest', 'oldest', 'lowest', 'highest']) {
    assert.deepEqual(plain(sortPurchases(rows, sort)), plain(sortPurchases([...rows].reverse(), sort)));
  }
});

test('receipt groups keep duplicate lines and product groups use exact normalized names, after filtering', () => {
  const sorted = sortPurchases(rows, 'lowest');
  const grouped = groupPurchases(sorted, 'receipt');
  assert.equal(grouped[0].key, 'later');
  assert.equal(grouped.find(group => group.key === 'end').rows.length, 2);
  assert.equal(grouped.flatMap(group => group.rows).length, rows.length);
  const products = groupPurchases(sorted, 'product');
  assert.equal(products.length, 3);
  assert.equal(products.find(group => group.key === 'milk').rows.length, 6);
  assert.equal(products.find(group => group.key === 'milk chocolate').rows.length, 1);
  const matches = filterPurchases(rows, { merchant: 'REWE', category: 'Food' });
  assert.equal(groupPurchases(matches, 'product')[0].rows.length, 3);
  assert.equal(groupPurchases([], 'receipt').length, 0);
});

test('history includes full exact-product history; cheapest previous excludes same-day/future and keeps all ties', () => {
  const result = productPriceHistory(rows, rows[0]);
  assert.deepEqual(ids(result.history), ['first', 'end', 'end', 'latest', 'same-day', 'later']);
  assert.deepEqual(ids(result.cheapestPrevious), ['first', 'end']);
  assert.equal(result.cheapestPrevious[0].priceCents, 110);
  assert.equal(result.history.find(row => row.receiptId === 'latest').quantity, 2);
  assert.equal(result.history.find(row => row.receiptId === 'latest').priceCents, 300);
  assert.equal(productPriceHistory(rows, rows.find(row => row.receiptId === 'first')).cheapestPrevious.length, 0);
  assert.deepEqual(ids(productPriceHistory(rows, filterPurchases(rows, { merchant: 'REWE', fromDate: '2026-09-13' })[0]).cheapestPrevious), ['first', 'end']);
});

test('preserves printed and normalized text, provenance and input; excludes invalid or sensitive rows', () => {
  const before = JSON.stringify(receipts);
  filterPurchases(rows, {}); sortPurchases(rows, 'lowest'); groupPurchases(rows, 'product'); productPriceHistory(rows, rows[0]);
  assert.equal(JSON.stringify(receipts), before);
  assert.equal(rows[0].name, 'Milk'); assert.equal(rows[0].originalText, 'MILCH'); assert.equal(rows[0].receiptId, 'latest');
  const bad = [receipt('date', '2026-02-30', 'Shop', [['Milk', 2]]), receipt('price', '2026-01-01', 'Shop', [['Milk', NaN], ['Milk', -1], ['Milk', 1, 0]]),
    receipt('secret', '2026-01-01', 'Shop', [['Milk', 1, 1, 'Food', 'VISA **1234']])];
  assert.equal(purchaseRows(bad).length, 0);
  const fraction = purchaseRows([receipt('fraction', '2026-01-01', 'Shop', [['Milk', .1 + .2]])]);
  assert.equal(fraction[0].priceCents, 30);
});

test('screen controls filter/group/sort; purchase and history evidence open receipt detail and refresh after edits', () => {
  let state = []; let cursor; let saved = receipts;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
    useState: initial => { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
    useMemo: compute => compute(),
  };
  const mocks = { react: { ...react, default: react },
    'react-native': { Platform: { OS: 'android' }, StyleSheet: { create: x => x }, ...Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'Pressable', 'SafeAreaView', 'ScrollView', 'SectionList', 'Text', 'TextInput', 'View'].map(x => [x, x])) },
    '../store/ReceiptStore': { useReceiptStore: () => ({ receipts: saved, hydrated: true }) },
    '../theme': { colors: {} }, './ReceiptDetailScreen': { ReceiptDetailScreen: 'ReceiptDetailScreen' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/screens/PurchasesScreen.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: name => mocks[name] ?? load(path.basename(name)) });
  const render = () => { cursor = 0; return exports.PurchasesScreen(); };
  function nodes(tree) {
    if (!tree || typeof tree !== 'object') return [];
    if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
    return [tree, ...(tree.props?.children ?? []).flatMap(nodes)];
  }
  const find = (tree, type) => nodes(tree).find(n => n.type === type);
  const press = (tree, label) => nodes(tree).find(n => n.type === 'Pressable' && nodes(n).some(x => x.type === 'Text' && x.props.children.includes(label))).props.onPress();
  let tree = render();
  let list = find(tree, 'SectionList');
  assert.equal(list.props.sections[0].key, 'later');
  press(tree, 'Filters & sort'); tree = render();
  press(tree, 'REWE'); press(tree, 'Product'); press(tree, 'Lowest price'); tree = render();
  list = find(tree, 'SectionList');
  assert.equal(list.props.sections.length, 2); assert.equal(list.props.sections[0].key, 'milk');
  assert.equal(list.props.sections[0].data[0].priceCents, 110);
  press(tree, 'Show 4 purchase lines'); tree = render();
  const rowTree = list.props.renderItem({ item: list.props.sections[0].data[0] });
  nodes(rowTree).find(n => n.props.accessibilityLabel?.startsWith('View receipt')).props.onPress();
  tree = render(); assert.equal(find(tree, 'ReceiptDetailScreen').props.receiptId, 'end');
  find(tree, 'ReceiptDetailScreen').props.onBack();
  press(rowTree, 'Price history & cheapest previous'); tree = render();
  assert.ok(nodes(tree).some(n => n.type === 'Text' && n.props.children.includes('Cheapest before ')));
  const proof = nodes(tree).find(n => n.props.accessibilityLabel?.includes('ALDI'));
  proof.props.onPress(); tree = render();
  assert.equal(find(tree, 'ReceiptDetailScreen').props.receiptId, 'first');
  assert.equal(find(tree, 'ReceiptDetailScreen').props.backLabel, 'Back to price history');
  find(tree, 'ReceiptDetailScreen').props.onBack();
  saved = receipts.filter(r => r.id !== 'first'); tree = render();
  assert.equal(nodes(tree).some(n => n.props.accessibilityLabel?.includes('ALDI')), false);
  press(tree, 'Back to purchases'); tree = render();
  assert.equal(find(tree, 'Modal').props.visible, false);
  list = find(tree, 'SectionList');
  find(list.props.ListHeaderComponent, 'TextInput').props.onChangeText('missing');
  tree = render(); list = find(tree, 'SectionList'); assert.equal(list.props.sections.length, 0);
  assert.ok(nodes(list.props.ListEmptyComponent).some(n => n.props.children.includes('No matching purchases')));
  saved = []; tree = render(); list = find(tree, 'SectionList');
  assert.ok(nodes(list.props.ListEmptyComponent).some(n => n.props.children.includes('Your purchase memory starts here')));
});
