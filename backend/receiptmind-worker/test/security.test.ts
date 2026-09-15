import { env } from 'cloudflare:workers';
import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeAll, afterEach, expect, test, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker, { type Env } from '../src/index';
import { boundedBody, identity } from '../src/security';

let privateKey: CryptoKey;
let jwk: object;
beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  privateKey = keys.privateKey;
  jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
});
afterEach(() => vi.restoreAllMocks());

async function appleToken(audience = 'com.shameem.receiptmind', key?: CryptoKey, expired = false) {
  return new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://appleid.apple.com').setAudience(audience).setSubject('user-one')
    .setIssuedAt().setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 60 : '1h').sign(key ?? privateKey);
}
function sessionRequest(jwt?: string) {
  return new Request('https://api.example/receipt/session', { method: 'POST',
    headers: { 'CF-Connecting-IP': '192.0.2.10', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) } });
}
test('Apple sign-in unlocks scanning without Google configuration and does not spend a scan', async () => {
  const h = harness({ GOOGLE_WEB_CLIENT_ID: '', APPLE_BUNDLE_ID: 'com.shameem.receiptmind', USER_SCANS_PER_MONTH: '1' });
  const jwt = await appleToken();
  const response = await worker.fetch(sessionRequest(jwt), h.config);
  expect(response.status).toBe(200);
  expect((await response.json()).expiresAt).toBeGreaterThan(Date.now());
  expect(h.calls()).toBe(0);
  expect((await worker.fetch(upload(jwt), h.config)).status).toBe(200);
  expect(h.calls()).toBe(1);
});
test('session preflight fails closed for missing auth, wrong Apple audience, expiry, signature and missing configuration', async () => {
  const h = harness({ APPLE_BUNDLE_ID: 'com.shameem.receiptmind' });
  const other = await generateKeyPair('RS256');
  for (const jwt of [undefined, await appleToken('other.app'), await appleToken(undefined, undefined, true), await appleToken(undefined, other.privateKey)]) {
    expect((await worker.fetch(sessionRequest(jwt), h.config)).status).toBe(401);
  }
  expect((await worker.fetch(sessionRequest(await appleToken()), { ...h.config, APPLE_BUNDLE_ID: '' })).status).toBe(503);
  expect((await worker.fetch(sessionRequest(await appleToken()), { ...h.config, SCANS_ENABLED: 'false' })).status).toBe(503);
  expect(h.calls()).toBe(0);
});
test('Apple and Google subjects have independent scan identities', async () => {
  const h = harness({ APPLE_BUNDLE_ID: 'com.shameem.receiptmind', USER_SCANS_PER_MONTH: '1' });
  expect((await worker.fetch(upload(await appleToken()), h.config)).status).toBe(200);
  expect((await worker.fetch(upload(await token()), h.config)).status).toBe(200);
  expect((await worker.fetch(upload(await appleToken()), h.config)).status).toBe(429);
});
const receipt = { merchant: 'Synthetic shop', purchaseDate: '2026-09-14', total: 2, currency: 'EUR',
  items: [{ originalText: 'Apples', name: 'Apples', category: 'Food', quantity: 1, price: 2, confidence: 1 }] };

function harness(overrides: Partial<Env> = {}) {
  const logs: string[] = [];
  vi.spyOn(console, 'log').mockImplementation(value => logs.push(value));
  let providerCalls = 0;
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs' || url === 'https://appleid.apple.com/auth/keys') return Response.json({ keys: [jwk] });
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      providerCalls++;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(receipt) }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 } });
    }
    throw new Error('Unexpected network destination');
  });
  const config: Env = { ...env, GEMINI_API_KEY: 'synthetic-key', ABUSE_HASH_KEY: crypto.randomUUID(),
    GOOGLE_WEB_CLIENT_ID: 'test-client', SCANS_ENABLED: 'true', ALLOWED_ORIGINS: 'https://app.example',
    USER_REQUESTS_PER_MINUTE: '100', IP_REQUESTS_PER_MINUTE: '100', USER_SCANS_PER_MONTH: '50', IP_SCANS_PER_DAY: '200',
    INPUT_USD_PER_MILLION: '1', OUTPUT_USD_PER_MILLION: '2', ...overrides };
  return { config, logs, network, calls: () => providerCalls };
}
async function token(claims = {}, key = privateKey) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://accounts.google.com').setAudience('test-client').setSubject('user-one')
    .setIssuedAt().setExpirationTime('1h').sign(key);
}
function upload(bearer?: string, headers = {}, bytes = new Uint8Array([255, 216, 255, 224]), type = 'image/jpeg') {
  const form = new FormData();
  form.append('receipt', new File([bytes], 'private-receipt.jpg', { type }));
  return new Request('https://api.example/receipt/extract', { method: 'POST', body: form,
    headers: { 'CF-Connecting-IP': '192.0.2.10', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers } });
}
test('missing and invalid authentication never call Gemini', async () => {
  const h = harness();
  for (const [bearer, code] of [[undefined, 'AUTH_REQUIRED'], ['invalid', 'AUTH_INVALID']]) {
    const response = await worker.fetch(upload(bearer), h.config);
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe(code);
  }
  expect(h.calls()).toBe(0);
});
test('rejects forged, expired, wrong issuer and wrong audience tokens', async () => {
  const h = harness();
  const wrongKey = (await generateKeyPair('RS256')).privateKey;
  const base = { iss: 'https://accounts.google.com', aud: 'test-client', sub: 'u', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 };
  for (const claims of [{ ...base, exp: 1 }, { ...base, aud: 'other-app' }, { ...base, iss: 'https://evil.example' }, { ...base, sub: undefined }]) {
    const jwt = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(privateKey);
    expect((await worker.fetch(upload(jwt), h.config)).status).toBe(401);
  }
  expect((await worker.fetch(upload(await token({}, wrongKey)), h.config)).status).toBe(401);
  expect(h.calls()).toBe(0);
});
test('successful extraction meters only safe metadata and keeps native CORS access', async () => {
  const h = harness();
  const jwt = await token();
  const response = await worker.fetch(upload(jwt), h.config);
  expect(response.status).toBe(200);
  expect((await response.json()).merchant).toBe(receipt.merchant);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  const log = JSON.parse(h.logs[0]);
  expect(log).toMatchObject({ requestCount: 1, providerAttempts: 1, inputTokens: 100, outputTokens: 25, estimatedCostUsd: 0.00015 });
  for (const secret of [jwt, 'synthetic-key', receipt.merchant, 'Apples', 'private-receipt', '192.0.2.10', 'user-one']) expect(h.logs.join('')).not.toContain(secret);
});
test('per-user limits survive requests from different IPs', async () => {
  const h = harness({ USER_REQUESTS_PER_MINUTE: '1' });
  const jwt = await token();
  expect((await worker.fetch(upload(jwt), h.config)).status).toBe(200);
  const response = await worker.fetch(upload(jwt, { 'CF-Connecting-IP': '192.0.2.11' }), h.config);
  expect(response.status).toBe(429);
  expect((await response.json()).code).toBe('RATE_LIMITED');
  expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(h.calls()).toBe(1);
});
test('IP rate limit includes unauthenticated requests', async () => {
  const h = harness({ IP_REQUESTS_PER_MINUTE: '1' });
  expect((await worker.fetch(upload(), h.config)).status).toBe(401);
  const response = await worker.fetch(upload(await token()), h.config);
  expect((await response.json()).code).toBe('RATE_LIMITED');
  expect(h.calls()).toBe(0);
});
test('monthly quota is atomic under concurrent extraction requests', async () => {
  const h = harness({ USER_SCANS_PER_MONTH: '1' });
  const jwt = await token();
  const responses = await Promise.all(Array.from({ length: 8 }, () => worker.fetch(upload(jwt), h.config)));
  expect(responses.filter(r => r.status === 200)).toHaveLength(1);
  for (const r of responses.filter(r => r.status !== 200)) expect((await r.json()).code).toBe('SCAN_ALLOWANCE_EXHAUSTED');
  expect(h.calls()).toBe(1);
});
test('IP scan quota and zero user allowance block provider work', async () => {
  for (const overrides of [{ IP_SCANS_PER_DAY: '0' }, { USER_SCANS_PER_MONTH: '0' }]) {
    const h = harness(overrides);
    const r = await worker.fetch(upload(await token()), h.config);
    expect((await r.json()).code).toBe('SCAN_ALLOWANCE_EXHAUSTED');
    expect(h.calls()).toBe(0);
    vi.restoreAllMocks();
  }
});
test('CORS permits only exact configured browser origins', async () => {
  const h = harness();
  for (const origin of ['null', 'https://evil.example', 'https://app.example.evil']) {
    const r = await worker.fetch(upload(await token(), { Origin: origin }), h.config);
    expect(r.status).toBe(403); expect(r.headers.has('Access-Control-Allow-Origin')).toBe(false);
  }
  const r = await worker.fetch(new Request('https://api.example/receipt/extract', { method: 'OPTIONS', headers: {
    Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }), h.config);
  expect(r.status).toBe(204); expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
  expect(h.calls()).toBe(0);
});
test('invalid signature/type and oversized streamed uploads never call provider', async () => {
  const h = harness(); const jwt = await token();
  for (const r of [upload(jwt, {}, new Uint8Array([1,2,3])), upload(jwt, {}, new Uint8Array([255,216,255]), 'application/pdf')]) {
    expect((await worker.fetch(r, h.config)).status).toBe(415);
  }
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10*1024*1024+65537)); c.close(); } });
  const r = await worker.fetch(new Request('https://api.example/receipt/extract', { method: 'POST', body: stream,
    headers: { Authorization: `Bearer ${jwt}`, 'CF-Connecting-IP': '192.0.2.10', 'Content-Type': 'multipart/form-data; boundary=test' } }), h.config);
  expect(r.status).toBe(413); expect(h.calls()).toBe(0);
});
test('bounded input times out a stalled stream', async () => {
  await expect(boundedBody(new ReadableStream({}), 100, 5)).rejects.toMatchObject({ code: 'UPLOAD_TIMEOUT' });
});
test('limiter storage contains counters only and minute calls preserve month retention', async () => {
  const h = harness();
  const key = await identity(h.config, 'user', 'storage-test');
  const guard = h.config.SCAN_GUARD.getByName(key);
  const now = Date.now();
  expect(await guard.consume([{name:'scans',start:now,end:now+60000,maximum:1}])).toBe(0);
  expect(await h.config.SCAN_GUARD.getByName(key).consume([{name:'scans',start:now,end:now+60000,maximum:1}])).toBeGreaterThan(0);
  expect(await h.config.SCAN_GUARD.getByName(key+'other').consume([{name:'scans',start:now,end:now+60000,maximum:1}])).toBe(0);
  const retained = await runInDurableObject(guard, async (_, state) => ({
    alarm: await state.storage.getAlarm(), values: [...await state.storage.list()],
  }));
  expect(retained.values).toEqual([['scans', { start: now, count: 1 }]]);
  await guard.consume([{name:'requests',start:now,end:now+1000,maximum:1}]);
  expect(await runInDurableObject(guard, (_, state) => state.storage.getAlarm())).toBe(retained.alarm);
  await runDurableObjectAlarm(guard);
  expect(await runInDurableObject(guard, async (_, state) => (await state.storage.list()).size)).toBe(0);
});

test('limiter outages and disabled or malformed configuration fail closed', async () => {
  const h = harness();
  const jwt = await token();
  for (const [overrides, code] of [
    [{ SCAN_GUARD: { getByName() { throw new Error('private internal details'); } } }, 'LIMITER_UNAVAILABLE'],
    [{ SCANS_ENABLED: 'false' }, 'SCANS_DISABLED'],
    [{ USER_SCANS_PER_MONTH: 'NaN' }, 'SERVICE_CONFIG'],
    [{ INPUT_USD_PER_MILLION: '' }, 'SERVICE_CONFIG'],
  ] as const) {
    const response = await worker.fetch(upload(jwt), { ...h.config, ...overrides } as Env);
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe(code);
  }
  expect(h.calls()).toBe(0);
  expect(h.logs.join('')).not.toContain('private internal details');
});
