const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  const state = { granted: true, canceled: false, failure: false, size: 100, mime: 'image/jpeg' };
  const calls = [];
  const result = async () => { if (state.failure) throw Error('PRIVATE NATIVE DATA'); return { canceled: state.canceled, assets: [{ uri: 'file:///receipt', fileName: 'receipt.jpg', name: 'receipt.pdf', mimeType: state.mime, size: state.size, fileSize: state.size }] }; };
  const mocks = {
    'expo-document-picker': { getDocumentAsync: async o => { calls.push(['file', o]); return result(); } },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
      requestCameraPermissionsAsync: async () => { calls.push(['permission']); return { granted: state.granted, canAskAgain: false }; },
      launchCameraAsync: async o => { calls.push(['camera', o]); return result(); },
      launchImageLibraryAsync: async o => { calls.push(['gallery', o]); return result(); } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/receiptInput.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: n => mocks[n] });
  return { ...exports, state, calls };
}
test('camera permission is requested on demand and denial prevents capture', async () => {
  const h = harness(); h.state.granted = false;
  await assert.rejects(h.pickReceipt('camera'), error => error.openSettings === true);
  assert.deepEqual(h.calls.map(c => c[0]), ['permission']);
});
test('gallery and PDF use system pickers without camera or storage permission', async () => {
  const h = harness(); await h.pickReceipt('gallery'); h.state.mime = 'application/pdf'; await h.pickReceipt('file');
  assert.deepEqual(h.calls.map(c => c[0]), ['gallery', 'file']);
  assert.equal(h.calls[1][1].copyToCacheDirectory, true);
  assert.equal(h.calls[1][1].multiple, false);
  assert.equal(h.calls[0][1].preferredAssetRepresentationMode, 'compatible');
});
test('cancel, oversized images and native failures do not become receipt input', async () => {
  const h = harness(); h.state.canceled = true; assert.equal(await h.pickReceipt('gallery'), null);
  h.state.canceled = false; h.state.size = 11 * 1024 * 1024; await assert.rejects(h.pickReceipt('file'), /smaller/);
  h.state.size = 100; h.state.mime = 'image/heic'; await assert.rejects(h.pickReceipt('gallery'), /JPEG/);
  h.state.failure = true; await assert.rejects(h.pickReceipt('camera'), e => !e.message.includes('PRIVATE'));
});
