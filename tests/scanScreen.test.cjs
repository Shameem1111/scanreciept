const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Drive the screen's actual handlers with mocked native and network boundaries.
function harness() {
  const state = { signedIn: false, failure: false, cancelled: false, calls: [], saved: [] };
  const slots = [];
  let cursor = 0;
  const asset = { uri: 'file:///receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg' };
  const result = { merchant: 'Arnika-Apotheke am Herkomerplatz', purchaseDate: '', total: 123.12, currency: 'EUR', source: 'ai',
    items: [{ id: '1', name: 'Exem Foam KIT 1St', originalText: 'Exem Foam KIT 1St', quantity: 1, price: 123.12, category: 'Medicine', confidence: 0.95 }] };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }]; } };
  const mocks = {
    react,
    'react-native': { Platform: { OS: 'ios' }, StyleSheet: { create: s => s }, Alert: { alert: (...args) => state.calls.push(['alert', ...args]) } },
    '../components/Ui': { Card: 'Card', PrimaryButton: 'PrimaryButton', SecondaryButton: 'SecondaryButton' },
    '../components/ReceiptReview': { ReceiptReview: 'ReceiptReview' },
    '../data': {}, '../theme': { colors: {} },
    '../services/storage': { storageProviders: { local: { isConfigured: () => true } } },
    '../services/storageErrors': { storageErrorMessage: () => 'Save failed' },
    '../services/historyData': { hasDuplicate: () => !!state.duplicate },
    '../store/ReceiptStore': { useReceiptStore: () => ({ receipts: [], storageProvider: 'local', saveReceipt: async (...args) => state.saved.push(args) }) },
    '../services/receiptInput': { ReceiptInputError: class extends Error {}, pickReceipt: async source => { state.calls.push(['pick', source]); return state.cancelled ? null : asset; } },
    '../services/receiptAuth': { isReceiptSignedIn: () => state.signedIn, signInForReceipts: async provider => { state.calls.push(['signIn', provider]); state.signedIn = true; } },
    '../services/receiptAi': { extractReceipt: async input => { state.calls.push(['extract', input]); if (state.failure) throw Error('Reading failed'); return result; } },
  };
  function load(filename) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true,
    } }).outputText, { exports, __DEV__: false, require: name => name in mocks ? mocks[name] : load(`src/services/${name.split('/').pop()}.ts`) });
    return exports;
  }
  const { ScanScreen } = load('src/screens/ScanScreen.tsx');
  function nodes(node) { return node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(nodes)] : []; }
  function render() { cursor = 0; return nodes(ScanScreen()); }
  return { state, asset, render, button: label => render().find(n => n.props.label?.includes(label)),
    review: () => render().find(n => n.type === 'ReceiptReview'),
    flush: () => new Promise(resolve => setImmediate(resolve)) };
}

test('scan reads selected receipt and prefills editable item and exact amount without inventing a date', async () => {
  const h = harness(); h.button('Scan Receipt').props.onPress(); await h.flush();
  assert.deepEqual(h.state.calls.map(c => c[0]), ['pick', 'signIn', 'extract']);
  const review = h.review();
  assert.equal(review.props.draft.merchant, 'Arnika-Apotheke am Herkomerplatz');
  assert.equal(review.props.draft.total, '123.12');
  assert.equal(review.props.draft.items[0].name, 'Exem Foam KIT 1St');
  assert.equal(review.props.draft.items[0].price, '123.12');
  assert.equal(review.props.draft.purchaseDate, '');
  review.props.onChange({ ...review.props.draft, purchaseDate: '2026-09-15' });
  await h.review().props.onSave();
  assert.equal(h.state.saved[0][0].items[0].price, 123.12);
  assert.equal(h.state.saved[0][1], h.asset);
});

test('failed extraction keeps original for retry and only opens manual review explicitly', async () => {
  const h = harness(); h.state.failure = true;
  h.button('Scan Receipt').props.onPress(); await h.flush();
  assert.equal(h.review(), undefined);
  assert.ok(h.button('Enter details manually'));
  h.state.failure = false;
  h.button('Retry automatic reading').props.onPress(); await h.flush();
  assert.equal(h.review().props.draft.source, 'ai');
  assert.equal(h.state.calls.filter(c => c[0] === 'pick').length, 1);
  assert.equal(h.state.calls.filter(c => c[0] === 'signIn').length, 1);
});

test('manual fallback is explicit and picker cancellation never calls extraction', async () => {
  const h = harness(); h.state.cancelled = true;
  h.button('Scan Receipt').props.onPress(); await h.flush();
  assert.deepEqual(h.state.calls.map(c => c[0]), ['pick']);
  h.state.cancelled = false; h.state.failure = true;
  h.button('Scan Receipt').props.onPress(); await h.flush();
  h.button('Enter details manually').props.onPress();
  assert.equal(h.review().props.draft.source, 'manual');
  assert.equal(h.button('Retry automatic reading'), undefined);
});

test('duplicate warning appears after extraction and saving waits for explicit override', async () => {
  const h = harness(); h.state.duplicate = true;
  h.button('Scan Receipt').props.onPress(); await h.flush();
  assert.ok(h.state.calls.some(c => c[0] === 'alert' && c[1] === 'Receipt already available'));
  const review = h.review();
  review.props.onChange({ ...review.props.draft, purchaseDate: '2026-09-15' });
  await h.review().props.onSave();
  assert.equal(h.state.saved.length, 0);
  const warning = h.state.calls.filter(c => c[0] === 'alert').at(-1);
  warning[3].find(button => button.text === 'Save anyway').onPress(); await h.flush();
  assert.equal(h.state.saved.length, 1);
  assert.equal(h.state.saved[0][2], true);
});
