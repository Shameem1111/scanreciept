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
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
    }).outputText, { exports, TextEncoder, TextDecoder, Uint8Array,
      require: name => name in mocks ? mocks[name] : load(path.resolve(path.dirname(filename), name)) }, { filename });
    return exports;
  }
  return load;
}
const original = () => ({ id: 'receipt-1', merchant: 'Shop', purchaseDate: '2026-09-13', total: 2, currency: 'EUR', source: 'ai',
  items: [{ id: 'item-1', originalText: 'MILCH', name: 'Milk', quantity: 1, price: 2, category: 'Food', confidence: .9 }],
  storageProvider: 'local', storageReference: 'file:///original.pdf', originalFilename: 'receipt.pdf', createdAt: '2026-09-13T00:00:00Z' });
function harness(initial = [original()]) {
  const kv = new Map(); const files = new Set(['file:///original.pdf']); const calls = [];
  const state = { stored: initial, failSave: false, failRemove: false, failCleanup: false, failCopy: false, failKey: false, readError: false, key: true, cloudConnected: true, failJournal: false };
  let id = 0;
  const load = loader({
    '@react-native-async-storage/async-storage': { default: {
      getItem: async k => kv.get(k) ?? null, setItem: async (k,v) => { if(state.failJournal && k.includes("original-pending")) throw Error("storage full"); kv.set(k,v); }, removeItem: async k => { kv.delete(k); },
    } },
    'expo-crypto': { randomUUID: () => String(++id) },
    './historyExport': { clearExportFiles: async () => calls.push('clear exports'), shareHistoryJson: async json => calls.push(JSON.parse(json)) },
    './encryptedStore': {
      getEncryptedJson: async () => { if(state.readError) throw Error('sensitive native error'); return state.stored; },
      setEncryptedJson: async (k,v) => { calls.push(k); if(state.failSave) throw Error('disk full'); state.stored = v; },
      removeEncryptedJson: async () => { if(state.failRemove) throw Error('remove failed'); state.stored = null; },
      deleteEncryptionKey: async () => { if(state.failKey) throw Error('locked'); state.key = false; },
    },
    './storage': {
      plannedLocalReference: (_,id) => 'file:///'+id,
      saveReceiptAsset: async (provider, asset, id, planned) => {
        if(provider === 'google-drive') {
          assert.equal(JSON.parse(kv.get('@receiptmind/original-pending/v1')).reference, planned);
          files.add(planned); if(state.failCopy) throw Error('upload response lost'); return {provider,reference:planned};
        }
        files.add('file:///'+id); if(state.failCopy) throw Error('partial copy'); return { provider, reference: 'file:///'+id };
      },
      storageProviders: { 'google-drive': {
        isAvailable: async () => state.cloudConnected,
        connect: async () => { state.cloudConnected=true; },
        disconnect: async () => { state.cloudConnected=false; },
        forgetConnection: async () => { state.cloudConnected=false; calls.push('forget cloud'); },
        prepareSave: async (_,id) => 'gdrive://account/'+id,
        deleteReceipt: async ref => { if(state.failCleanup || !state.cloudConnected) throw Error('cloud cleanup failed'); files.delete(ref); },
      }, local: {
        deleteReceipt: async ref => { if(state.failCleanup) throw Error('cleanup failed'); files.delete(ref); },
        deleteAll: async () => { if(state.failCleanup) throw Error('cleanup failed'); for(const file of files)if(file.startsWith('file:'))files.delete(file); },
      } },
    },
  });
  const { HistoryManager } = load('services/historyManager');
  const manager = new HistoryManager(() => {});
  return { manager, state, files, kv, calls, load };
}
const asset = { uri: 'file:///input', name: 'receipt.pdf', mimeType: 'application/pdf' };
test('JSON export is versioned, complete, sanitized and excludes injected fields and keys', async () => {
  const r=original(); r.cardNumber='secret'; r.items[0].bankAccount='secret'; r.originalFilename='VISA **1234';
  const { manager }=harness([r]); await manager.hydrate();
  const result=JSON.parse(manager.exportJson());
  assert.equal(result.version,1); assert.equal(result.receipts[0].items[0].originalText,'MILCH');
  assert.equal(result.receipts[0].storageReference,r.storageReference);
  assert.equal(result.receipts[0].originalFilename,'[PAYMENT INFORMATION REMOVED]');
  assert.ok(!JSON.stringify(result).includes('secret'));
  await manager.exportPurchaseHistory();
});
test('individual and history-only deletion retain originals/key; failed deletes preserve history', async () => {
  const h=harness([original(), {...original(),id:'other'}]); await h.manager.hydrate();
  h.state.failSave=true; await assert.rejects(h.manager.deleteReceipt('receipt-1'),/Free device storage/);
  assert.equal(h.manager.state.receipts.length,2);
  h.state.failSave=false; await h.manager.deleteReceipt('receipt-1'); assert.equal(h.manager.state.receipts[0].id,'other');
  h.state.failRemove=true; await assert.rejects(h.manager.deleteHistory()); assert.equal(h.manager.state.receipts.length,1);
  h.state.failRemove=false; await h.manager.deleteHistory();
  assert.equal(h.manager.state.receipts.length,0); assert.equal(h.files.size,1); assert.equal(h.state.key,true); assert.equal(h.state.stored,null);
});
test('delete everything removes originals retained after history deletion, settings, exports and key', async () => {
  const h=harness(); await h.manager.hydrate(); await h.manager.deleteHistory();
  h.kv.set('@receiptmind/settings/v1','{}'); await h.manager.deleteEverything();
  assert.equal(h.files.size,0); assert.equal(h.state.key,false); assert.equal(h.kv.size,0); assert.equal(h.state.stored,null);
  assert.ok(h.calls.includes('clear exports'));
});
test('interrupted device deletion stays blocked across restart and is retryable', async () => {
  const h=harness(); await h.manager.hydrate(); h.state.failKey=true;
  await assert.rejects(h.manager.deleteEverything()); assert.ok(h.manager.state.recovery);
  await h.manager.hydrate(); assert.match(h.manager.state.recovery,/interrupted/);
  await assert.rejects(h.manager.deleteHistory(),/Finish/);
  await assert.rejects(h.manager.addReceipt(original()));
  h.state.failKey=false; await h.manager.deleteEverything(); assert.equal(h.manager.state.recovery,null); assert.equal(h.state.key,false);
});
test('invalid document, invalid record and decryption/read failure block writes and export until explicit recovery', async () => {
  for(const value of [{}, [null], [{...original(),items:'broken'}], [{...original(),total:'2'}], [original(),original()]]) {
    const h=harness(value); await h.manager.hydrate(); assert.ok(h.manager.state.recovery);
    assert.throws(()=>h.manager.exportJson(),/could not be read/);
    await assert.rejects(h.manager.addReceipt(original())); assert.equal(h.state.stored,value);
    await h.manager.deleteHistory(); assert.equal(h.manager.state.recovery,null); assert.equal(h.files.size,1);
  }
  const h=harness(); h.state.readError=true; await h.manager.hydrate(); assert.ok(h.manager.state.recovery);
  h.state.readError=false; await h.manager.hydrate(); assert.equal(h.manager.state.receipts.length,1); assert.equal(h.manager.state.recovery,null);
});
test('failed encrypted save or partial original copy rolls back new file and retains previous history', async () => {
  for(const failure of ['failSave','failCopy']) {
    const h=harness(); await h.manager.hydrate(); h.state[failure]=true;
    await assert.rejects(h.manager.saveReceipt({...original(),merchant:'New shop'},asset),/Free device storage/);
    assert.equal(h.files.size,1); assert.ok(h.files.has('file:///original.pdf'));
    assert.equal(h.state.stored.length,1); assert.equal(h.manager.state.receipts.length,1); assert.equal(h.kv.size,0);
  }
});
test('rollback cleanup failure retains journal and blocks new saves until retry succeeds', async () => {
  const h=harness(); await h.manager.hydrate(); h.state.failSave=true; h.state.failCleanup=true;
  await assert.rejects(h.manager.saveReceipt({...original(),merchant:'New shop'},asset));
  assert.ok(h.manager.state.recovery); assert.ok(h.kv.has('@receiptmind/original-pending/v1'));
  h.state.failCleanup=false; h.state.failSave=false; await h.manager.hydrate();
  assert.equal(h.files.size,1); assert.equal(h.kv.size,0); assert.equal(h.manager.state.recovery,null);
});
test('startup journal removes uncommitted original but preserves committed original', async () => {
  for(const committed of [true,false]) {
    const h=harness(); h.kv.set('@receiptmind/original-pending/v1',committed ? 'file:///original.pdf' : 'file:///pending'); h.files.add('file:///pending');
    await h.manager.hydrate(); assert.ok(h.files.has('file:///original.pdf'));
    assert.equal(h.files.has('file:///pending'),committed); assert.equal(h.kv.size,0);
  }
});
test('duplicate warning precedes copying; explicit override saves; concurrent mutations retain both results', async () => {
  const h=harness(); await h.manager.hydrate();
  await assert.rejects(h.manager.saveReceipt({...original(),merchant:' SHOP '},asset),/duplicate/); assert.equal(h.files.size,1);
  await h.manager.saveReceipt(original(),asset,true); assert.equal(h.manager.state.receipts.length,2);
  await Promise.all([h.manager.addReceipt({...original(),id:'a'}),h.manager.addReceipt({...original(),id:'b'})]);
  assert.equal(h.manager.state.receipts.length,4); assert.equal(h.state.stored.length,4);
});
test('edits persist encrypted and retain provenance, with no publication on failed save', async () => {
  const h=harness(); await h.manager.hydrate(); const draft=h.load('services/receiptReview').createReviewDraft(original()); draft.merchant='Updated shop';
  h.state.failSave=true; await assert.rejects(h.manager.updateReceipt('receipt-1',draft)); assert.equal(h.manager.state.receipts[0].merchant,'Shop');
  h.state.failSave=false; await h.manager.updateReceipt('receipt-1',draft);
  assert.equal(h.manager.state.receipts[0].merchant,'Updated shop'); assert.equal(h.manager.state.receipts[0].storageReference,original().storageReference);
  assert.ok(h.calls.includes('@receiptmind/receipts/encrypted-v1'));
});
test('encrypted reader distinguishes missing from malformed, missing-key, authentication and JSON failures without generating a key', async () => {
  for(const scenario of ['absent','empty','hex','key','auth','json','null','ok']) {
    let generated=0;
    const service=loader({
      '@react-native-async-storage/async-storage': {default:{getItem:async()=>scenario==='absent'?null:scenario==='empty'?'':scenario==='hex'?'zz':'aabb'}},
      'expo-secure-store': {getItemAsync:async()=>scenario==='key'?null:'key'},
      'expo-crypto': {AESEncryptionKey:{import:async()=>({}),generate:async()=>{generated++;}}, AESSealedData:{fromCombined:x=>x},
        aesDecryptAsync:async()=>{if(scenario==='auth') throw Error('authentication');return scenario==='json'?'broken':scenario==='null'?'null':'[]';}},
    })('services/encryptedStore');
    if(scenario==='absent') assert.equal(await service.getEncryptedJson('history'),null);
    else if(scenario==='ok') assert.equal((await service.getEncryptedJson('history')).length,0);
    else await assert.rejects(service.getEncryptedJson('history'),/corrupted or cannot be decrypted/);
    assert.equal(generated,0);
  }
});

test('JSON sharing removes its plaintext temporary file on success, cancellation or failure', async () => {
  for (const failure of ['none','share','write']) {
    const files=new Map(); const dirs=new Set(); let delivered;
    class Directory {
      constructor(...p){ this.uri=p.map(x=>x.uri??x).join('/'); }
      get exists(){return dirs.has(this.uri);}
      create(){dirs.add(this.uri);}
      delete(){dirs.delete(this.uri);for(const name of files.keys())if(name.startsWith(this.uri+'/'))files.delete(name);}
    }
    class File {
      constructor(...p){this.uri=p.map(x=>x.uri??x).join('/');}
      write(text){files.set(this.uri,text);if(failure==='write')throw Error('full');}
    }
    const service=loader({
      'expo-file-system':{Directory,File,Paths:{cache:'file:///cache'}},
      'expo-sharing':{isAvailableAsync:async()=>true,shareAsync:async(uri)=>{delivered=files.get(uri);if(failure==='share')throw Error('cancelled');}},
    })('services/historyExport');
    if(failure==='none'){await service.shareHistoryJson('{"receipts":[]}');assert.equal(delivered,'{"receipts":[]}');}
    else await assert.rejects(service.shareHistoryJson('{}'));
    assert.equal(files.size,0);assert.equal(dirs.size,0);
  }
});

test('switching local/Drive affects only new saves and preserves historical references after disconnect',async()=>{
  const h=harness();await h.manager.hydrate();await h.manager.setStorageProvider('google-drive');
  await h.manager.saveReceipt({...original(),merchant:'Cloud shop'},asset);
  const saved=h.manager.state.receipts[0];assert.equal(saved.storageProvider,'google-drive');assert.match(saved.storageReference,/^gdrive:\/\/account\//);
  assert.equal(h.state.stored[0].storageReference,saved.storageReference);
  await h.manager.setStorageProvider('local');assert.equal(h.manager.state.receipts[0].storageReference,saved.storageReference);
  await h.manager.setStorageProvider('google-drive');await h.manager.disconnectStorage('google-drive');
  assert.equal(h.manager.state.storageProvider,'local');assert.equal(h.manager.state.receipts.length,2);assert.ok(h.files.has(saved.storageReference));
  await assert.rejects(h.manager.setStorageProvider('google-drive'),/Connect/);
  await h.manager.connectStorage('google-drive');await h.manager.setStorageProvider('google-drive');
});
test('Drive save is journaled before upload, rollback handles lost responses and failed structured saves',async()=>{
  for(const failure of ['failCopy','failSave']){
    const h=harness();await h.manager.hydrate();await h.manager.setStorageProvider('google-drive');h.state[failure]=true;
    await assert.rejects(h.manager.saveReceipt({...original(),merchant:'Cloud shop'},asset));
    assert.equal(h.files.size,1);assert.equal(h.manager.state.receipts.length,1);assert.equal(h.kv.has('@receiptmind/original-pending/v1'),false);
  }
  const h=harness();await h.manager.hydrate();await h.manager.setStorageProvider('google-drive');h.state.failJournal=true;
  await assert.rejects(h.manager.saveReceipt({...original(),merchant:'Cloud shop'},asset));assert.equal(h.files.size,1);
});
test('disconnected cloud cleanup stays journaled across hydration without hiding structured purchases',async()=>{
  const h=harness();await h.manager.hydrate();await h.manager.setStorageProvider('google-drive');h.state.failSave=true;h.state.failCleanup=true;
  await assert.rejects(h.manager.saveReceipt({...original(),merchant:'Cloud shop'},asset));
  assert.ok(h.manager.state.storageWarning);assert.equal(h.manager.state.recovery,null);assert.equal(h.manager.state.receipts.length,1);
  h.state.cloudConnected=false;h.state.failSave=false;await h.manager.hydrate();
  assert.equal(h.manager.state.recovery,null);assert.ok(h.manager.state.storageWarning);assert.equal(h.manager.state.receipts.length,1);
  assert.equal(JSON.parse(h.manager.exportJson()).receipts.length,1);
  await assert.rejects(h.manager.saveReceipt({...original(),merchant:'Other'},asset));assert.equal(h.files.size,2);
  h.state.failCleanup=false;await h.manager.connectStorage('google-drive');await h.manager.retryStorageCleanup();
  assert.equal(h.files.size,1);assert.equal(h.manager.state.storageWarning,null);assert.equal(h.kv.has('@receiptmind/original-pending/v1'),false);
});
test('startup retains a committed Drive original and device deletion signs out without deleting cloud files',async()=>{
  const cloud={...original(),id:'cloud',storageProvider:'google-drive',storageReference:'gdrive://account/cloud'};
  const h=harness([original(),cloud]);h.files.add(cloud.storageReference);
  h.kv.set('@receiptmind/original-pending/v1',JSON.stringify({provider:'google-drive',reference:cloud.storageReference}));
  h.state.cloudConnected=false;await h.manager.hydrate();assert.equal(h.manager.state.receipts.length,2);assert.equal(h.manager.state.storageWarning,null);
  await h.manager.deleteEverything();assert.equal(h.files.size,1);assert.ok(h.files.has(cloud.storageReference));assert.equal(h.state.key,false);assert.ok(h.calls.includes('forget cloud'));
});

test('deleting a committed receipt with a lingering journal preserves its original on recovery',async()=>{
  const cloud={...original(),id:'cloud',storageProvider:'google-drive',storageReference:'gdrive://account/cloud'};
  const h=harness([cloud]);h.files.add(cloud.storageReference);await h.manager.hydrate();
  h.kv.set('@receiptmind/original-pending/v1',JSON.stringify({provider:'google-drive',reference:cloud.storageReference}));
  await h.manager.deleteReceipt('cloud');await h.manager.hydrate();
  assert.equal(h.manager.state.receipts.length,0);assert.ok(h.files.has(cloud.storageReference));
});
