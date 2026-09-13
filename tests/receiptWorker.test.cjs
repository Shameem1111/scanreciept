const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function loadWorker(fetch) {
  const filename = path.resolve(__dirname, '../backend/receiptmind-worker/src/index.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, fetch, Request, Response, FormData, File, URL, Uint8Array, btoa,
    AbortController, setTimeout, clearTimeout,
    console: { warn: (event, details) => {
      assert.equal(event, 'receipt_extraction_provider_error');
      assert.deepEqual(Object.keys(details), ['status']);
    } },
  }, { filename });
  return exports.default;
}

function request() {
  const form = new FormData();
  form.append('receipt', new File(['synthetic test bytes'], 'receipt.jpg', { type: 'image/jpeg' }));
  return new Request('https://receipt.example/receipt/extract', { method: 'POST', body: form });
}
const env = { GEMINI_API_KEY: 'test-only-key' };
const extraction = (name) => ({
  merchant: 'Test shop', purchaseDate: '2026-09-13', total: 1234.56, currency: 'EUR',
  items: [{ originalText: name, name, category: 'Food', quantity: 1, price: 1234.56, confidence: 0.9 }],
});
const success = (value) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] });

test('German and English extraction preserves item language and numerical values', async () => {
  for (const name of ['BIO MÜSLI groß', 'Organic apples']) {
    const worker = loadWorker(async (url, options) => {
      const body = JSON.parse(options.body);
      const prompt = body.systemInstruction.parts[0].text;
      assert.match(prompt, /German, English, and mixed German\/English/);
      assert.match(prompt, /1\.234,56/);
      assert.match(prompt, /1,234\.56/);
      assert.match(prompt, /13\.09\.2026/);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
      const value = extraction(name);
      value.items.push({ ...value.items[0], originalText: 'VISA **1234' });
      return success(value);
    });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    const actual = await response.json();
    assert.equal(actual.items.length, 1);
    assert.equal(actual.items[0].originalText, name);
    assert.equal(actual.total, 1234.56);
    assert.equal(actual.purchaseDate, '2026-09-13');
  }
});

test('provider configuration and quota errors have safe distinct codes without retry', async () => {
  for (const [status, code] of [[400, 'PROVIDER_CONFIG'], [401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'], [404, 'PROVIDER_CONFIG'], [429, 'PROVIDER_QUOTA']]) {
    let calls = 0;
    const worker = loadWorker(async () => {
      calls++;
      return new Response('private provider detail', { status });
    });
    const response = await worker.fetch(request(), env);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(JSON.stringify(body).includes('private provider detail'), false);
    assert.equal(calls, 1);
  }
});

test('temporary provider failure is retried once and can recover', async () => {
  let calls = 0;
  const worker = loadWorker(async () => ++calls === 1
    ? new Response('overloaded', { status: 503 }) : success(extraction('Apples')));
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(calls, 2);
});

test('persistent provider failures stop after two attempts', async () => {
  let calls = 0;
  const worker = loadWorker(async () => { calls++; return new Response(null, { status: 503 }); });
  const response = await worker.fetch(request(), env);
  assert.equal((await response.json()).code, 'PROVIDER_UNAVAILABLE');
  assert.equal(calls, 2);
});

test('malformed AI output and unreadable receipts have distinct errors', async () => {
  for (const [payload, code] of [[{}, 'INVALID_AI_RESPONSE'],
    [{ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...extraction('Apples'), purchaseDate: '' }) }] } }] }, 'UNREADABLE_RECEIPT']]) {
    const worker = loadWorker(async () => Response.json(payload));
    const response = await worker.fetch(request(), env);
    assert.equal((await response.json()).code, code);
  }
});

test('invalid multipart input does not call the AI provider', async () => {
  const worker = loadWorker(() => assert.fail('No AI call for malformed upload'));
  const response = await worker.fetch(new Request('https://receipt.example/receipt/extract', { method: 'POST', body: 'invalid' }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'INVALID_UPLOAD');
});
