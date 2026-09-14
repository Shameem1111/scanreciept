const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { exports, require: name => mocks[name] ?? load('services/' + name.replace('./', '') + '.ts'), Date });
  return exports;
}
const { AppLock, parseLockSettings } = load('services/appLock.ts');
function harness(settings = { enabled: true, backgroundSeconds: 60 }) {
  const state = { now: 1000, settings, success: true, writes: [], failRead: false, failWrite: false, authCalls: 0 };
  const adapters = {
    now: () => state.now,
    read: async () => { if (state.failRead) throw Error('private error'); return state.settings; },
    write: async next => { if (state.failWrite) throw Error('private error'); state.writes.push(next); state.settings = next; },
    authenticate: async () => { state.authCalls++; return state.success; },
  };
  const lock = new AppLock(adapters, () => {});
  lock.activity('active');
  return { lock, state, adapters };
}
test('cold launch does not start history until device authentication succeeds', async () => {
  const { lock, state } = harness();
  assert.equal(lock.state.sessionStarted, false);
  await lock.load(); assert.equal(lock.state.locked, true);
  state.success = false; await lock.unlock(); assert.equal(lock.state.sessionStarted, false);
  state.success = true; await lock.unlock(); assert.equal(lock.state.sessionStarted, true); assert.equal(lock.state.locked, false);
});
test('disabled lock needs no authentication but settings changes require proof', async () => {
  const { lock, state } = harness({ enabled: false, backgroundSeconds: 60 });
  await lock.load(); assert.equal(lock.state.locked, false); assert.equal(state.authCalls, 0);
  state.success = false; await lock.configure({ enabled: true, backgroundSeconds: 0 });
  assert.equal(lock.state.enabled, false); assert.equal(state.writes.length, 0);
  state.success = true; await lock.configure({ enabled: true, backgroundSeconds: 0 });
  assert.equal(lock.state.enabled, true); assert.equal(state.writes.length, 1);
});
test('background grace period preserves session then locks at the exact boundary', async () => {
  const { lock, state } = harness(); await lock.load(); await lock.unlock();
  lock.activity('background'); assert.equal(lock.state.active, false);
  state.now += 59999; lock.activity('active'); assert.equal(lock.state.locked, false);
  lock.activity('background'); state.now += 60000; lock.activity('active'); assert.equal(lock.state.locked, true);
  // Store remains alive to finish pending writes; UI is separately gated.
  assert.equal(lock.state.sessionStarted, true);
});
test('immediate lock and backwards device clock both fail closed', async () => {
  for (const delay of [0, 60]) {
    const { lock, state } = harness({ enabled: true, backgroundSeconds: delay }); await lock.load(); await lock.unlock();
    lock.activity('background'); if (delay) state.now -= 1000;
    lock.activity('active'); assert.equal(lock.state.locked, true);
  }
});
test('inactive biometric dialog covers content without rejecting successful authentication', async () => {
  const { lock, adapters } = harness(); await lock.load();
  adapters.authenticate = async () => { lock.activity('inactive'); return true; };
  await lock.unlock(); assert.equal(lock.state.locked, false); assert.equal(lock.state.active, false);
  lock.activity('active'); assert.equal(lock.state.locked, false);
});
test('late authentication after background cannot unlock and duplicate prompts are blocked', async () => {
  const { lock, adapters } = harness(); await lock.load();
  let finish; let calls = 0;
  adapters.authenticate = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = lock.unlock(); await lock.unlock(); assert.equal(calls, 1);
  lock.activity('background'); lock.activity('active'); finish(true); await pending;
  assert.equal(lock.state.locked, true);
});
test('unreadable settings, bad schema and failed writes never disable security', async () => {
  const { lock, state } = harness(); state.failRead = true; await lock.load();
  assert.equal(lock.state.ready, false); assert.equal(lock.state.locked, true); assert.equal(lock.state.error.includes('private'), false);
  for (const raw of ['garbage', '{}', '{"enabled":false,"backgroundSeconds":-1}', '{"enabled":"false","backgroundSeconds":60}']) assert.throws(() => parseLockSettings(raw));
  state.failRead = false; await lock.load(); await lock.unlock(); state.failWrite = true;
  await lock.configure({ enabled: false, backgroundSeconds: 60 }); assert.equal(lock.state.enabled, true);
});
test('native auth permits passcode fallback, strong biometrics and stores only separate lock settings', async () => {
  const calls = []; let failPrivacy = true;
  const service = load('services/deviceSecurity.ts', {
    'react-native': { Platform: { OS: 'ios' } },
    'expo-secure-store': { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', getItemAsync: async () => null,
      setItemAsync: async (...args) => calls.push(['secure', ...args]), deleteItemAsync: async key => calls.push(['delete', key]) },
    'expo-local-authentication': { SecurityLevel: { NONE: 0 }, getEnrolledLevelAsync: async () => 1,
      authenticateAsync: async options => { calls.push(['auth', options]); return { success: true }; } },
    'expo-screen-capture': { preventScreenCaptureAsync: async key => { calls.push(['capture', key]); if (failPrivacy) throw Error(); },
      enableAppSwitcherProtectionAsync: async intensity => calls.push(['switcher', intensity]) },
  });
  await assert.rejects(service.prepareScreenPrivacy()); failPrivacy = false; await service.prepareScreenPrivacy();
  assert.notEqual(calls[0][1], calls[1][1]);
  assert.equal(await service.authenticateDevice(), true);
  const options = calls.find(c => c[0] === 'auth')[1];
  assert.equal(options.disableDeviceFallback, false); assert.equal(options.biometricsSecurityLevel, 'strong');
  await service.writeLockSettings({ enabled: true, backgroundSeconds: 30 });
  const stored = calls.find(c => c[0] === 'secure'); assert.equal(stored[1], 'receiptmind-app-lock-v1');
  assert.equal(stored[3].keychainAccessible, 'device-only');
  assert.equal(JSON.parse(stored[2]).enabled, true);
});
test('UI gates withhold protected children before unlock and after relocking', () => {
  const context = { state: { ready: false, sessionStarted: false, locked: true, active: true }, lock: {} };
  const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    createContext: () => ({}), useContext: () => context };
  const component = load('components/AppLock.tsx', { react: { ...react, default: react },
    'react-native': { StyleSheet: { create: s => s }, View: 'View', Text: 'Text', AppState: {} },
    '../services/appLock': { AppLock }, '../services/deviceSecurity': {}, './Ui': { PrimaryButton: 'Button' }, '../theme': { colors: {} } });
  const child = { type: 'PrivateHistory' };
  assert.equal(component.InitialUnlockGate({ children: child }).type, component.LockedScreen);
  context.state.ready = true; context.state.sessionStarted = true;
  assert.equal(component.AppLockBoundary({ children: child }).type, component.LockedScreen);
  context.state.locked = false; context.state.active = false;
  const hidden = component.AppLockBoundary({ children: child }).props.children[0];
  assert.equal(hidden.props.pointerEvents, 'none'); assert.equal(hidden.props.importantForAccessibility, 'no-hide-descendants');
});
