const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the actual TypeScript service without loading the native Expo runtime.
function loadService(endpoint, fetch) {
  function load(relativePath) {
    const filename = path.resolve(__dirname, '../src/services', relativePath + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
      exports, require: load, process: { env: { EXPO_PUBLIC_RECEIPT_AI_ENDPOINT: endpoint } },
      fetch, AbortController, setTimeout, clearTimeout,
      FormData: class {
        fields = new Map();
        append(key, value) { this.fields.set(key, value); }
      },
    }, { filename });
    return exports;
  }
  return load('receiptAi');
}

const asset = { uri: 'file:///camera/receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg' };
const result = {
  merchant: 'Actual shop', purchaseDate: '2026-09-13', total: 3.5, currency: 'EUR', source: 'ai',
  items: [{ id: '1', name: 'Apples', originalText: 'APPLES', category: 'Food', quantity: 1, price: 3.5, confidence: 0.9 }],
};
const response = (value) => ({ ok: true, json: async () => value });

test('missing endpoint rejects without uploading or substituting demo items', async () => {
  const service = loadService(' ', () => assert.fail('Must not upload without an endpoint'));
  await assert.rejects(service.extractReceipt(asset), /not configured/);
});

test('uploads the selected asset and returns real sanitized items', async () => {
  const service = loadService('https://receipt.example/extract', async (url, options) => {
    assert.equal(url, 'https://receipt.example/extract');
    const upload = options.body.fields.get('receipt');
    assert.equal(upload.uri, asset.uri);
    assert.equal(upload.name, asset.name);
    assert.equal(upload.type, asset.mimeType);
    assert.equal(options.body.fields.get('privacy_mode'), 'no-payment-data');
    return response({ ...result, paymentReference: 'discard', items: [
      { ...result.items[0], paymentReference: 'discard' },
      { ...result.items[0], name: 'VISA **1234' },
    ] });
  });
  const actual = await service.extractReceipt(asset);
  assert.equal(actual.merchant, 'Actual shop');
  assert.equal(actual.items.length, 1);
  assert.equal(actual.items[0].name, 'Apples');
  assert.equal(actual.source, 'ai');
  assert.equal('paymentReference' in actual, false);
  assert.equal('paymentReference' in actual.items[0], false);
});

test('failed requests never return demo data', async () => {
  const service = loadService('https://receipt.example/extract', async () => ({ ok: false, status: 503 }));
  await assert.rejects(service.extractReceipt(asset), /503/);
});

test('rejects demo, malformed, and empty extraction responses', async () => {
  for (const invalid of [null, {}, { ...result, source: 'demo' }, { ...result, total: '3.50' }, { ...result, items: [] }]) {
    const service = loadService('https://receipt.example/extract', async () => response(invalid));
    await assert.rejects(service.extractReceipt(asset), /invalid result|No purchase items/);
  }
});
