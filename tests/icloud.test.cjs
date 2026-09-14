const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function harness(os = 'ios') {
  const state = { status: 'available', present: true, exists: true, fail: false, shareFail: false };
  const calls = [];
  const reference = 'icloud://iCloud.com.shameem.receiptmind/account/uuid.pdf';
  const native = {
    status: async () => state.status,
    prepare: async ext => { calls.push(['prepare',ext]); return reference; },
    exists: async ref => { calls.push(['exists',ref]); return state.exists; },
    save: async (...args) => { calls.push(['save',...args]); if(state.fail) throw Error('private native payload'); },
    read: async ref => { calls.push(['read',ref]); if(state.fail) throw Error('private native payload'); return 'file:///cache/preview.pdf'; },
    remove: async ref => { calls.push(['remove',ref]); if(state.fail) throw Error('private native payload'); },
  };
  class File { constructor(uri) {this.uri=uri;} exists=true; delete(){calls.push(['delete',this.uri]);} }
  class Directory extends File { constructor(...parts){super(parts.join('/'));} }
  const mocks = {
    'react-native': {Platform:{OS:os}},
    'expo-modules-core': {requireOptionalNativeModule: () => {calls.push(['native']); return state.present ? native : null;}},
    'expo-file-system': {File,Directory,Paths:{cache:'file:///cache'}},
    'expo-sharing': {isAvailableAsync:async()=>true,shareAsync:async uri=>{calls.push(['share',uri]);if(state.shareFail)throw Error('private viewer payload');}},
  };
  const errors={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/storageErrors.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:errors});
  mocks['./storageErrors']=errors;
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/icloud.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:n=>{if(!(n in mocks))throw Error('Unexpected dependency');return mocks[n];}});
  return {provider:exports.icloudProvider,state,calls,reference};
}
const asset={uri:'file:///input.pdf',name:'private original.pdf',mimeType:'application/pdf'};
test('Android/web never load Apple APIs and explain available alternatives',async()=>{
  for(const os of ['android','web']){const h=harness(os);assert.equal(h.provider.isConfigured(),false);assert.equal(await h.provider.isAvailable(),false);await assert.rejects(h.provider.save(asset,'id'),/only on iOS/);assert.match(await h.provider.connectionStatus(),/Google Drive/);assert.equal(h.calls.length,0);}
});
test('missing native build, signed-out and disabled iCloud return actionable status',async()=>{
  const h=harness();h.state.present=false;assert.equal(h.provider.isConfigured(),false);assert.match(await h.provider.connectionStatus(),/Expo Go/);
  h.state.present=true;h.state.status='signed-out';assert.equal(await h.provider.isAvailable(),false);await assert.rejects(h.provider.prepareSave(asset,'id'),/Sign in/);
  h.state.status='unavailable';assert.match(await h.provider.connectionStatus(),/signing/);
});
test('reserves reference before save, passes original bytes source and never original filename',async()=>{
  const h=harness();assert.equal(await h.provider.isAvailable(),true);
  const ref=await h.provider.prepareSave(asset,'id');assert.equal(ref,h.reference);
  await assert.rejects(h.provider.save(asset,'id'),/journaled/);
  const saved=await h.provider.save(asset,'id',ref);assert.equal(saved.reference,ref);assert.equal(saved.provider,'icloud');
  assert.ok(h.calls.some(c=>c[0]==='save'&&c[1]===asset.uri&&c[2]===ref));assert.ok(!JSON.stringify(h.calls).includes(asset.name));
  await assert.rejects(h.provider.prepareSave({...asset,mimeType:'text/plain'},'id'),/Unsupported/);
});
test('preview uses native download/read, removes temporary copy on success or viewer failure',async()=>{
  const h=harness();await h.provider.openReceipt(h.reference);assert.ok(h.calls.some(c=>c[0]==='read'));assert.ok(h.calls.some(c=>c[0]==='delete'));
  h.state.shareFail=true;await assert.rejects(h.provider.openReceipt(h.reference),/Original receipt unavailable/);assert.equal(h.calls.filter(c=>c[0]==='delete').length,2);
  await h.provider.cleanupTemporaryFiles();assert.ok(h.calls.some(c=>c[1]==='file:///cache/ReceiptMindICloudPreviews'));
});
test('missing files and native account/access/download/write failures stay safe and preserve reference',async()=>{
  const h=harness();h.state.exists=false;assert.equal(await h.provider.isAvailable(h.reference),false);h.state.fail=true;
  for(const action of [()=>h.provider.openReceipt(h.reference),()=>h.provider.save(asset,'id',h.reference),()=>h.provider.deleteReceipt(h.reference)]) await assert.rejects(action(),e=>!e.message.includes('private'));
  h.state.fail=false;await h.provider.deleteReceipt(h.reference);assert.ok(h.calls.some(c=>c[0]==='remove'&&c[1]===h.reference));
});
