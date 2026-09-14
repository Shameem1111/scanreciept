const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function loader(mocks = {}, env = {}) {
  const cache = {};
  function load(filename) {
    filename = path.resolve(__dirname, '../src', filename);
    if (!path.extname(filename)) filename += '.ts';
    if (cache[filename]) return cache[filename];
    const exports = cache[filename] = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
    }).outputText, { exports, URL, AbortController, setTimeout, clearTimeout, process: { env },
      require: name => name in mocks ? mocks[name] : load(path.resolve(path.dirname(filename), name)) }, { filename });
    return exports;
  }
  return load;
}
const scope='https://www.googleapis.com/auth/drive.file';
const ref='gdrive://accountA/fileA';
const asset={uri:'file:///input.pdf',name:'PRIVATE CARD 1234.pdf',mimeType:'application/pdf'};
function harness(os='android', env={EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID:'123-test.apps.googleusercontent.com',EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:'456-test.apps.googleusercontent.com'}) {
  const state={account:'accountA',scope:true,token:'access-token-test',idToken:'test-id-token',cancel:false,revoked:false,revocationFailure:false,signOutFailure:false,playServices:true,nativeFailure:false,scopeDenied:false};
  const calls=[], requests=[], opened=[], responses=[];
  const user=()=>({type:'success',data:{scopes:state.scope?[scope]:[],user:{id:state.account,email:'must-not-persist@example.invalid'}}});
  const sdk={
    configure: options=>calls.push(['configure',options]),
    hasPlayServices:async()=>state.playServices,
    signIn:async()=>{calls.push(['signIn']);if(state.nativeFailure)throw Error('native secret response');return state.cancel?{type:'cancelled'}:user();},
    signInSilently:async()=>{if(state.revoked)return {type:'noSavedCredentialFound'};return user();},
    addScopes:async options=>{calls.push(['addScopes',options]);if(state.scopeDenied)return {type:'cancelled'};state.scope=true;return user();},
    getTokens:async()=>({accessToken:state.token,idToken:state.idToken}),
    clearCachedAccessToken:async token=>{calls.push(['invalidate',token]);state.token='fresh-token-test';},
    revokeAccess:async()=>{calls.push(['revoke']);if(state.revocationFailure)throw Error('offline secret');state.revoked=true;},
    signOut:async()=>{calls.push(['signOut']);if(state.signOutFailure)throw Error('failure secret');state.revoked=true;},
  };
  class File { constructor(uri){this.uri=uri;} exists=true; size=100; }
  const load=loader({
    'react-native':{Platform:{OS:os},Linking:{openURL:async url=>opened.push(url)}},
    '@react-native-google-signin/google-signin':{GoogleSignin:sdk},
    'expo-file-system':{File},
    'expo/fetch':{fetch:async(url,init)=>{requests.push({url,...init});const response=responses.shift();if(response instanceof Error)throw response;if(!response)throw Error('Unexpected request');return response;}},
  },env);
  return {state,calls,requests,opened,responses,auth:load('services/googleDriveAuth'),provider:load('services/googleDrive').googleDriveProvider};
}
function reply(status,data={},headers={}){return {status,ok:status>=200&&status<300,json:async()=>data,headers:{get:key=>headers[key]??null}};}
test('mobile OAuth requests drive.file without secrets, web client or server/offline access',async()=>{
  for(const os of ['android','ios']){
    const h=harness(os);await h.provider.connect();
    const options=h.calls.find(c=>c[0]==='configure')[1];
    assert.deepEqual(Array.from(options.scopes),[]);assert.equal(options.offlineAccess,false);
    assert.equal(options.webClientId,undefined);assert.equal(options.clientSecret,undefined);assert.equal(options.androidClientId,undefined);
    assert.equal(options.iosClientId,os==='ios'?'456-test.apps.googleusercontent.com':undefined);
    assert.equal(await h.provider.isAvailable(),true);
  }
});
test('missing IDs, folder URLs, web and missing native module stay unconfigured',async()=>{
  for(const [os,env] of [['android',{}],['ios',{}],['web',{}],['android',{EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID:'https://drive.google.com/drive/folders/shared'}]]){
    const h=harness(os,env);assert.equal(h.provider.isConfigured(),false);await assert.rejects(h.provider.connect(),/setup/);assert.equal(h.requests.length,0);
  }
  const auth=loader({'react-native':{Platform:{OS:'android'}}},{EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID:'123-test.apps.googleusercontent.com'})('services/googleDriveAuth');
  assert.equal(auth.isGoogleConfigured(),false);await assert.rejects(auth.connectGoogle(),/native/);
});
test('cancellation, denied scope, unavailable play services and native errors use safe messages',async()=>{
  const h=harness();h.state.cancel=true;await assert.rejects(h.provider.connect(),/cancelled/);
  h.state.cancel=false;h.state.scope=false;h.state.scopeDenied=true;await assert.rejects(h.provider.connect(),/not granted/);
  assert.equal(await h.provider.isAvailable(),false);
  h.state.scopeDenied=false;await h.provider.connect();assert.equal(h.state.scope,true);
  h.state.playServices=false;await assert.rejects(h.provider.connect(),/Play services/);
  h.state.playServices=true;h.state.nativeFailure=true;await assert.rejects(h.provider.connect(),error=>!error.message.includes('secret'));
});
test('reserve a stable account/file reference then upload bytes directly to trusted Drive API',async()=>{
  const h=harness();h.responses.push(reply(200,{ids:['fileA']}));
  assert.equal(await h.provider.prepareSave(asset,'receipt-uuid'),ref);
  h.responses.push(reply(200,{}, {Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=session'}),reply(200,{id:'fileA'}));
  const saved=await h.provider.save(asset,'receipt-uuid',ref);assert.equal(saved.reference,ref);assert.equal(saved.provider,'google-drive');
  assert.match(h.requests[0].url,/generateIds/);
  const metadata=JSON.parse(h.requests[1].body);assert.equal(metadata.id,'fileA');assert.equal(metadata.name,'receipt-uuid.pdf');assert.equal(metadata.mimeType,'application/pdf');
  assert.equal(h.requests[2].method,'PUT');assert.equal(h.requests[2].body.uri,asset.uri);
  for(const r of h.requests){assert.match(r.url,/^https:\/\/www.googleapis.com\//);assert.equal(r.redirect,'error');assert.ok(!r.url.includes('token'));assert.equal(r.headers.Authorization,'Bearer access-token-test');}
  assert.ok(!JSON.stringify(metadata).includes('PRIVATE'));
  await assert.rejects(h.provider.save(asset,'unprepared'),/journaled/);
});
test('401 refreshes once, persistent auth failure asks reconnect, revoked account makes no API call',async()=>{
  const h=harness();h.responses.push(reply(401),reply(200,{id:'fileA',trashed:false}));
  assert.equal(await h.provider.isAvailable(ref),true);assert.equal(h.requests.length,2);
  assert.equal(h.requests[1].headers.Authorization,'Bearer fresh-token-test');assert.equal(h.calls.filter(c=>c[0]==='invalidate').length,1);
  h.responses.push(reply(401),reply(401));await assert.rejects(h.provider.openReceipt(ref),/expired or was revoked/);
  assert.equal(h.opened.length,0);h.state.revoked=true;const count=h.requests.length;
  assert.equal(await h.provider.isAvailable(ref),false);assert.equal(h.requests.length,count);
});
test('unavailable files and wrong accounts never change references or leak tokens to browser',async()=>{
  const h=harness();for(const response of [reply(404),reply(200,{id:'fileA',trashed:true}),reply(403)]){
    h.responses.push(response);assert.equal(await h.provider.isAvailable(ref),false);
  }
  h.state.account='accountB';await assert.rejects(h.provider.openReceipt(ref),/different Google account/);assert.equal(h.opened.length,0);
  h.state.account='accountA';h.responses.push(reply(200,{id:'fileA',trashed:false}));await h.provider.openReceipt(ref);
  assert.deepEqual(h.opened,['https://drive.google.com/file/d/fileA/view']);
  for(const invalid of ['https://evil.invalid/file','gdrive://accountA/../secret','gdrive://accountA/file?token=secret'])await assert.rejects(h.provider.openReceipt(invalid),/invalid/);
});
test('upload rejects hostile session URLs, malformed confirmation, quota and transport failures',async()=>{
  for(const location of ['https://evil.invalid/upload','http://www.googleapis.com/upload/drive/v3/files','https://www.googleapis.com.evil.invalid/upload/drive/v3/files','https://secret@www.googleapis.com/upload/drive/v3/files']){
    const h=harness();h.responses.push(reply(200,{}, {Location:location}));await assert.rejects(h.provider.save(asset,'receipt-id',ref),/invalid upload destination/);assert.equal(h.requests.length,1);
  }
  const h=harness();h.responses.push(reply(200,{}, {Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=x'}),reply(200,{id:'wrong'}));
  await assert.rejects(h.provider.save(asset,'receipt-id',ref),/did not confirm/);
  h.responses.push(reply(403));await assert.rejects(h.provider.prepareSave(asset,'r'),/available Drive storage/);
  h.responses.push(reply(429));await assert.rejects(h.provider.prepareSave(asset,'r'),/temporarily/);
  h.responses.push(Error('secret response'));await assert.rejects(h.provider.prepareSave(asset,'r'),error=>error.message.includes('connection')&&!error.message.includes('secret'));
});
test('rollback removes only the referenced file; 404 is idempotent; disconnect keeps originals',async()=>{
  const h=harness();for(const status of [204,404]){h.responses.push(reply(status));await h.provider.deleteReceipt(ref);}
  assert.ok(h.requests.every(r=>r.method==='DELETE'&&r.url==='https://www.googleapis.com/drive/v3/files/fileA'));
  const count=h.requests.length;await h.provider.disconnect();assert.equal(h.requests.length,count);assert.equal(await h.provider.isAvailable(),false);
  assert.deepEqual(h.calls.slice(-2).map(c=>c[0]),['revoke','signOut']);
  h.state.revocationFailure=true;await assert.rejects(h.provider.disconnect(),/Signed out on this device/);assert.equal(h.calls.at(-1)[0],'signOut');
  h.state.signOutFailure=true;await assert.rejects(h.provider.forgetConnection(),/Retry device deletion/);
});
test('native configuration derives only the supplied iOS scheme and preserves existing configuration',()=>{
  for(const id of [undefined,'123-ios.apps.googleusercontent.com']){
    const load=loader({},id?{EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:id}:{});
    const config=load('../app.config.ts').default({config:{name:'ReceiptMind',slug:'scanreciept',plugins:['expo-sharing'],android:{package:'com.shameem.receiptmind'}}});
    assert.equal(config.android.package,'com.shameem.receiptmind');assert.equal(config.plugins[0],'expo-sharing');
    assert.equal(config.plugins.length,id?2:1);
    if(id)assert.equal(config.plugins[1][1].iosUrlScheme,'com.googleusercontent.apps.123-ios');
  }
  assert.throws(()=>loader({},{EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID:'https://drive.google.com/folder'})('../app.config.ts').default({config:{}}),/not a URL or secret/);
});

test('device reset can clear an Android native session even without OAuth environment IDs',async()=>{
  const h=harness('android',{});assert.equal(h.provider.isConfigured(),false);
  await h.provider.forgetConnection();assert.deepEqual(h.calls.map(c=>c[0]),['configure','signOut']);
  assert.equal(h.state.revoked,true);assert.equal(h.requests.length,0);
});

test('receipt auth uses public audience and native ID token without Drive scope', async()=>{
  const h=harness('android',{EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID:'123-test.apps.googleusercontent.com',EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:'789-test.apps.googleusercontent.com'});
  h.state.scope=false; h.state.revoked=true;
  assert.equal(await h.auth.receiptAuthorization(),'test-id-token');
  const options=h.calls.find(c=>c[0]==='configure')[1];
  assert.equal(options.webClientId,'789-test.apps.googleusercontent.com');
  assert.deepEqual(Array.from(options.scopes),[]);
  assert.equal(h.calls.some(c=>c[0]==='addScopes'),false);
});
test('receipt auth rejects missing config, cancelled consent, and missing ID tokens safely', async()=>{
  await assert.rejects(harness().auth.receiptAuthorization(),/configuration/);
  for (const mode of ['cancel','missingToken']) {
    const h=harness('android',{EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID:'123-test.apps.googleusercontent.com',EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:'789-test.apps.googleusercontent.com'});
    h.state.revoked=true; h.state.cancel=mode==='cancel'; if(mode==='missingToken')h.state.idToken=null;
    await assert.rejects(h.auth.receiptAuthorization(),/Sign in to read receipts/);
    assert.equal(h.requests.length,0);
  }
});
