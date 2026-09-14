const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Use Expo's actual form patch and encoder, with the native Blob limitation enforced.
class NativeBlob {
  constructor() { throw new Error('Creating blobs from ArrayBuffer is not supported'); }
}
function loadExpo(relativePath) {
  const filename = path.resolve(__dirname, '../node_modules/expo/src', relativePath + '.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Blob: NativeBlob, TextEncoder, Uint8Array,
    require: (name) => loadExpo(path.relative(path.resolve(__dirname, '../node_modules/expo/src'),
      path.resolve(path.dirname(filename), name))),
  }, { filename });
  return exports;
}
const ExpoFormData = loadExpo('winter/FormData').installFormDataPatch(class {
  constructor() { this._parts = []; }
});
const { convertFormDataAsync } = loadExpo('winter/fetch/convertFormData');

// Exercise the actual TypeScript service without loading the native Expo runtime.
function loadService(endpoint, fetch, readFile = async () => new TextEncoder().encode('receipt file bytes').buffer) {
  function load(relativePath) {
    if (relativePath === './googleDriveAuth') return { receiptAuthorization: async () => 'test-id-token' };
    if (relativePath === 'expo/fetch') return { fetch: async (url, options) => {
      const encoded = await convertFormDataAsync(options.body);
      return fetch(url, { ...options, encoded });
    } };
    if (relativePath === 'expo-file-system') return { File: class {
      constructor(uri) { this.uri = uri; }
      async bytes() { return new Uint8Array(await readFile(this.uri)); }
      arrayBuffer() { throw new Error('Upload should use File.bytes()'); }
    } };
    const filename = path.resolve(__dirname, '../src/services', relativePath + '.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    vm.runInNewContext(code, {
      exports, require: load, process: { env: { EXPO_PUBLIC_RECEIPT_AI_ENDPOINT: endpoint } },
      AbortController, setTimeout, clearTimeout, Blob: NativeBlob, FormData: ExpoFormData,
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

test('merchant-only purchase survives client validation with exact cents', async () => {
  const service = loadService(undefined, async () => response({
    ...result, merchant: 'Apotheke Taufkirchen', purchaseDate: '2026-09-03', total: 373.16,
    items: [{ id: 'item-1', name: 'Apotheke Taufkirchen', originalText: 'Apotheke Taufkirchen',
      category: 'Other', quantity: 1, price: 373.16, confidence: 0.5 }],
  }));
  const actual = await service.extractReceipt(asset);
  assert.equal(actual.items.length, 1);
  assert.equal(actual.items[0].name, 'Apotheke Taufkirchen');
  assert.equal(actual.items[0].price, 373.16);
  assert.equal(actual.total, 373.16);
  assert.equal(actual.items[0].confidence, 0.5);
});

test('blank endpoint uses the configured default service', async () => {
  const service = loadService(' ', async (url) => {
    assert.equal(url, 'https://receiptmind-api.r7tg4t4tcc.workers.dev/receipt/extract');
    return response(result);
  });
  await service.extractReceipt(asset);
});

test('uploads the selected asset and returns real sanitized items', async () => {
  const service = loadService('https://receipt.example/extract', async (url, options) => {
    assert.equal(url, 'https://receipt.example/extract');
    assert.equal(options.headers.Authorization, 'Bearer test-id-token');
    assert.equal(options.redirect, 'error');
    const upload = options.body.get('receipt');
    assert.equal(typeof upload.bytes, 'function');
    assert.equal(new TextDecoder().decode(await upload.bytes()), 'receipt file bytes');
    assert.equal(upload.name, asset.name);
    assert.equal(upload.type, asset.mimeType);
    assert.equal(options.body.get('privacy_mode'), 'no-payment-data');
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

test('uploads PDF bytes with the selected filename and MIME type', async () => {
  const pdf = { uri: 'file:///cache/upload', name: 'shop receipt.pdf', mimeType: 'application/pdf' };
  const service = loadService(undefined, async (url, options) => {
    const multipart = new Request(url, {
      method: 'POST', body: options.encoded.body,
      headers: { 'Content-Type': `multipart/form-data; boundary=${options.encoded.boundary}` },
    });
    const parsed = await multipart.formData();
    const upload = parsed.get('receipt');
    assert.equal(decodeURIComponent(upload.name), pdf.name);
    assert.equal(upload.type, pdf.mimeType);
    assert.equal(await upload.text(), '%PDF-test');
    return response(result);
  }, async (uri) => {
    assert.equal(uri, pdf.uri);
    return new TextEncoder().encode('%PDF-test').buffer;
  });
  await service.extractReceipt(pdf);
});

test('unreadable local files fail before an upload', async () => {
  const service = loadService(undefined, () => assert.fail('Must not upload'), async () => {
    throw new Error('File unavailable');
  });
  await assert.rejects(service.extractReceipt(asset), /File unavailable/);
});

test('failed requests never return demo data', async () => {
  const service = loadService('https://receipt.example/extract', async () => ({ ok: false, status: 503, json: async () => { throw new Error('not JSON'); } }));
  await assert.rejects(service.extractReceipt(asset), /503/);
});

test('provider error codes become actionable messages without exposing raw errors', async () => {
  for (const [code, expected] of [['PROVIDER_AUTH', /API key/], ['PROVIDER_QUOTA', /quota or billing/], ['UNREADABLE_RECEIPT', /German or English/]]) {
    const service = loadService(undefined, async () => ({ ok: false, status: 503, json: async () => ({ code, error: 'private provider detail' }) }));
    await assert.rejects(service.extractReceipt(asset), (error) => {
      assert.match(error.message, expected);
      assert.equal(error.message.includes('private provider detail'), false);
      return true;
    });
  }
});

test('rejects demo, malformed, and empty extraction responses', async () => {
  for (const invalid of [null, {}, { ...result, source: 'demo' }, { ...result, total: '3.50' }, { ...result, items: [] }]) {
    const service = loadService('https://receipt.example/extract', async () => response(invalid));
    await assert.rejects(service.extractReceipt(asset), /invalid result|No purchase items/);
  }
});

test('client allows missing or ambiguous dates into review without retaining arbitrary text', async () => {
  for (const purchaseDate of [undefined, null, '', '2026-02-30', 'IBAN DE89370400440532013000']) {
    const service = loadService(undefined, async () => response({ ...result, purchaseDate }));
    assert.equal((await service.extractReceipt(asset)).purchaseDate, '');
  }
});

test('authentication and allowance errors never display server details', async()=>{
  for (const code of ['AUTH_REQUIRED','AUTH_INVALID','RATE_LIMITED','SCAN_ALLOWANCE_EXHAUSTED']) {
    const service=loadService(undefined,async()=>({ok:false,status:429,json:async()=>({code,error:'PRIVATE RECEIPT CONTENT'})}));
    await assert.rejects(service.extractReceipt(asset),error=>!error.message.includes('PRIVATE') && !error.message.includes('failed (429)'));
  }
});
test('non-TLS extraction endpoint is rejected before file access or sending credentials', async()=>{
  const service=loadService('http://receipt.example/extract',()=>assert.fail('No upload'));
  await assert.rejects(service.extractReceipt(asset),/not configured/);
});
