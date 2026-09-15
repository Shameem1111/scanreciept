const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const state = { now: Date.now(), cancel: false, revoked: false, status: 200, expires: 3600000 };
  const calls = [];
  class Clock extends Date { static now() { return state.now; } }
  const mocks = {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-apple-authentication': {
      isAvailableAsync: async () => true,
      signInAsync: async options => { calls.push(['apple', options]); if (state.cancel) throw Error('private native error'); return { identityToken: 'apple-token', user: 'apple-user' }; },
      getCredentialStateAsync: async () => state.revoked ? 0 : 1,
      AppleAuthenticationCredentialState: { AUTHORIZED: 1 },
    },
    './googleDriveAuth': { isGoogleConfigured: () => false, receiptAuthorization: async () => { throw Error('Google must not be needed'); } },
    'expo/fetch': { fetch: async (url, options) => { calls.push(['fetch', url, options]); return {
      ok: state.status === 200, status: state.status,
      json: async () => ({ expiresAt: state.now + state.expires }),
    }; } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/receiptAuth.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => mocks[name], process: { env: {} }, Date: Clock, URL, AbortController, setTimeout, clearTimeout });
  return { ...exports, state, calls };
}
test('unsigned sessions cannot authorize receipt access; Apple sign-in needs no Google IDs or identity scopes', async () => {
  const h = harness();
  assert.equal(h.isReceiptSignedIn(), false);
  await assert.rejects(h.receiptAuthorization(), /Sign in before/);
  assert.equal(h.calls.length, 0);
  await h.signInForReceipts('apple');
  assert.equal(h.isReceiptSignedIn(), true);
  assert.equal(h.getReceiptAuthProvider(), 'apple');
  assert.equal(h.getReceiptAuthExpiresAt(), h.state.now + 3600000);
  assert.equal(await h.receiptAuthorization(), 'apple-token');
  assert.equal(h.calls[0][1].requestedScopes.length, 0);
  assert.match(h.calls[1][1], /\/receipt\/session$/);
  assert.equal(h.calls[1][2].body, undefined);
});
test('cancelled, rejected, expired and revoked Apple sign-ins keep scanning locked', async () => {
  const h = harness();
  h.state.cancel = true;
  await assert.rejects(h.signInForReceipts('apple'), /cancelled/);
  assert.equal(h.isReceiptSignedIn(), false);
  assert.equal(h.calls.filter(c => c[0] === 'fetch').length, 0);
  h.state.cancel = false; h.state.status = 503;
  await assert.rejects(h.signInForReceipts('apple'), /finish service setup/);
  assert.equal(h.isReceiptSignedIn(), false);
  h.state.status = 200;
  await h.signInForReceipts('apple');
  h.state.now += 3600000;
  await assert.rejects(h.receiptAuthorization(), /Sign in before/);
  await h.signInForReceipts('apple');
  h.state.revoked = true;
  await assert.rejects(h.receiptAuthorization(), /no longer available/);
  assert.equal(h.isReceiptSignedIn(), false);
});
test('sign-out clears access and notifies the scan screen', async () => {
  const h = harness();
  await h.signInForReceipts('apple');
  let changes = 0;
  const unsubscribe = h.subscribeReceiptAuth(() => changes++);
  h.clearReceiptSession();
  assert.equal(changes, 1);
  assert.equal(h.isReceiptSignedIn(), false);
  assert.equal(h.getReceiptAuthProvider(), null);
  assert.equal(h.getReceiptAuthExpiresAt(), null);
  await assert.rejects(h.receiptAuthorization());
  unsubscribe();
});
