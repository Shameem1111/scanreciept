const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function loader(mocks = {}) {
  const cache = {};
  function load(filename) {
    filename = path.resolve(__dirname, '../src', filename);
    if (!path.extname(filename)) filename += '.ts';
    if (cache[filename]) return cache[filename];
    const exports = cache[filename] = {};
    const requireModule = name => name in mocks ? mocks[name] : load(path.resolve(path.dirname(filename), name));
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText, { exports, require: requireModule }, { filename });
    return exports;
  }
  return load;
}
function storage(os = 'android') {
  const files = new Map(); const opened = []; const shared = [];
  const state = { fail: false };
  class Directory {
    constructor(...parts) { this.uri = parts.map(x => x.uri ?? x).join('/'); }
    exists = true;
    delete() { for (const uri of files.keys()) if (uri.startsWith(this.uri + '/')) files.delete(uri); }
    list() { return [...files.keys()].filter(uri => uri.startsWith(this.uri + '/')).map(uri => new File(uri)); }
  }
  class File {
    constructor(...parts) { this.uri = parts.map(x => x.uri ?? x).join('/'); }
    get exists() { return files.has(this.uri); }
    get type() { return ''; }
    get contentUri() { return 'content://receipt/' + this.uri.split('/').pop(); }
    delete() { files.delete(this.uri); }
    async copy(destination) { files.set(destination.uri, true); }
  }
  const service = loader({
    './googleDrive': { googleDriveProvider: { isAvailable: async () => false, openReceipt: async () => { throw Error('Original receipt unavailable'); } } },
    'expo-file-system': { Directory, File, Paths: { document: 'file:///current/Documents', cache: 'file:///current/Cache' } },
    'react-native': { Platform: { OS: os } },
    'expo-intent-launcher': { startActivityAsync: async (...args) => { if (state.fail) throw Error('No viewer'); opened.push(args); } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (...args) => shared.push(args) },
  })('services/storage');
  return { service, files, opened, shared, state };
}
const reference = name => ({ storageProvider: 'local', storageReference: `file:///old/Documents/ReceiptMind/Receipts/${name}` });

test('saved image/PDF references open with MIME type and temporary Android read permission', async () => {
  const { service, opened } = storage();
  for (const [name, type] of [['photo.jpg', 'image/jpeg'], ['receipt.pdf', 'application/pdf']]) {
    const saved = await service.saveReceiptAsset('local', { uri: 'file:///cache/input', name, mimeType: type }, 'id');
    assert.equal(saved.reference, `file:///current/Documents/ReceiptMind/Receipts/id-${name}`);
    await service.openReceipt({ storageProvider: saved.provider, storageReference: saved.reference });
    assert.equal(opened.at(-1)[0], 'android.intent.action.VIEW');
    assert.equal(opened.at(-1)[1].type, type);
    assert.equal(opened.at(-1)[1].flags, 1);
    assert.match(opened.at(-1)[1].data, /^content:\/\//);
  }
});
test('legacy iOS container references resolve in current documents and open images/PDFs', async () => {
  const { service, files, shared } = storage('ios');
  for (const name of ['image.png', 'receipt.pdf']) {
    files.set(`file:///current/Documents/ReceiptMind/Receipts/${name}`, true);
    assert.equal(await service.isReceiptAvailable(reference(name)), true);
    await service.openReceipt(reference(name));
    assert.equal(shared.at(-1)[0], `file:///current/Documents/ReceiptMind/Receipts/${name}`);
  }
});
test('missing, malformed, disconnected and unsafe references are unavailable without deleting history', async () => {
  const { service } = storage();
  for (const receipt of [reference('missing.pdf'), reference('../secret'), reference('%2fsecret'), reference('%'),
    { storageProvider: 'local', storageReference: '' }, { storageProvider: 'local', storageReference: 'file:///secret' },
    { storageProvider: 'google-drive', storageReference: 'cloud-id' }, { storageProvider: 'icloud', storageReference: 'cloud-id' }]) {
    const before = JSON.stringify(receipt);
    assert.equal(await service.isReceiptAvailable(receipt), false);
    await assert.rejects(service.openReceipt(receipt), /Original receipt unavailable/);
    assert.equal(JSON.stringify(receipt), before);
  }
});
test('deletion between availability and opening plus native viewer failures are reported', async () => {
  const { service, files, state } = storage();
  const uri = 'file:///current/Documents/ReceiptMind/Receipts/a.pdf';
  files.set(uri, true);
  assert.equal(await service.isReceiptAvailable(reference('a.pdf')), true);
  files.delete(uri);
  await assert.rejects(service.openReceipt(reference('a.pdf')), /Original receipt unavailable/);
  files.set(uri, true); state.fail = true;
  await assert.rejects(service.openReceipt(reference('a.pdf')), /No viewer/);
});
const original = () => ({ id: 'receipt-1', merchant: 'Shop', purchaseDate: '2026-09-13', total: 2, currency: 'EUR', source: 'ai',
  items: [{ id: 'item-1', originalText: 'MILCH', name: 'Milk', quantity: 1, price: 2, category: 'Food', confidence: .9 }],
  storageProvider: 'local', storageReference: reference('missing.pdf').storageReference, originalFilename: 'receipt.pdf', createdAt: '2026-09-13T00:00:00Z' });
test('receipt updates retain original metadata despite a missing file or injected replacement metadata', () => {
  const load = loader(); const { updateStructuredReceipt } = load('services/receiptUpdate');
  const { createReviewDraft } = load('services/receiptReview');
  const old = original(); const other = { ...original(), id: 'other' };
  const draft = createReviewDraft(old);
  Object.assign(draft, { merchant: 'New shop', total: '3', storageProvider: 'google-drive', storageReference: 'replacement', printedTotal: 99 });
  draft.items[0].name = 'Organic milk'; draft.items[0].price = '3'; draft.items[0].category = 'Other';
  const result = updateStructuredReceipt([old, other], old.id, draft);
  assert.equal(result.length, 2); assert.equal(result[1], other); assert.equal(old.merchant, 'Shop');
  for (const key of ['id', 'createdAt', 'storageProvider', 'storageReference', 'originalFilename', 'source']) assert.equal(result[0][key], old[key]);
  assert.equal(result[0].printedTotal, 2); assert.equal(result[0].items[0].originalText, 'MILCH');
  assert.equal(result[0].merchant, 'New shop'); assert.equal(result[0].total, 3); assert.equal(result[0].items[0].category, 'Other');
  assert.throws(() => updateStructuredReceipt([old], 'unknown', draft), /no longer exists/);
  draft.items[0].name = 'VISA **1234';
  assert.throws(() => updateStructuredReceipt([old], old.id, draft), /Correct/);
});

test('local deletion is scoped to managed originals and whole-device cleanup also removes cached inputs', async () => {
  const { service, files } = storage();
  const original = 'file:///current/Documents/ReceiptMind/Receipts/old.pdf';
  files.set(original, true); files.set('file:///outside/source.pdf', true);
  await service.storageProviders.local.deleteReceipt(reference('old.pdf').storageReference);
  assert.equal(files.has(original), false);
  await service.storageProviders.local.deleteReceipt(reference('old.pdf').storageReference);
  for (const ref of ['file:///outside/source.pdf', reference('../source.pdf').storageReference, reference('%2fsource.pdf').storageReference]) {
    await assert.rejects(service.storageProviders.local.deleteReceipt(ref));
  }
  files.set(original, true); files.set('file:///current/Cache/DocumentPicker/input.pdf', true);
  await service.storageProviders.local.deleteAll();
  assert.equal(files.size, 1); assert.equal(files.has('file:///outside/source.pdf'), true);
});
