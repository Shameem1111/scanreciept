import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DurableObject } from 'cloudflare:workers';

export interface SecurityEnv extends Omit<CloudflareBindings, 'SCAN_GUARD'> {
  SCAN_GUARD: DurableObjectNamespace<ScanGuard>;
  ABUSE_HASH_KEY: string;
}

export class SafeError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryAfter?: number) {
    super('Receipt request could not be completed.');
  }
}

// Only public signing keys are cached. Never cache tokens or user payloads.
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 3600000,
});

export async function authenticate(request: Request, env: SecurityEnv): Promise<string> {
  const header = request.headers.get('authorization');
  if (!header) throw new SafeError('AUTH_REQUIRED', 401);
  if (!/^Bearer [A-Za-z0-9_.-]+$/.test(header) || header.length > 8192) throw new SafeError('AUTH_INVALID', 401);
  if (!env.GOOGLE_WEB_CLIENT_ID) throw new SafeError('SERVICE_CONFIG', 503);
  try {
    const { payload } = await jwtVerify(header.slice(7), googleKeys, {
      algorithms: ['RS256'], audience: env.GOOGLE_WEB_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      requiredClaims: ['sub', 'exp', 'iat'], maxTokenAge: '1h',
    });
    if (!payload.sub || payload.sub.length > 255) throw new Error();
    return payload.sub;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC' || error instanceof TypeError) {
      throw new SafeError('AUTH_UNAVAILABLE', 503);
    }
    throw new SafeError('AUTH_INVALID', 401);
  }
}

export function limit(value: string, maximum = 1000000): number {
  if (!/^\d+$/.test(value ?? '') || Number(value) > maximum) throw new SafeError('SERVICE_CONFIG', 503);
  return Number(value);
}

export async function identity(env: SecurityEnv, kind: string, value: string): Promise<string> {
  if (!env.ABUSE_HASH_KEY || env.ABUSE_HASH_KEY.length < 32) throw new SafeError('SERVICE_CONFIG', 503);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ABUSE_HASH_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${kind}:${value}`));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export type Window = { name: string; start: number; end: number; maximum: number };

// One object per pseudonymous user or IP. Atomic reservations survive concurrent
// requests and isolate failures from other identities; no receipt data enters storage.
export class ScanGuard extends DurableObject<SecurityEnv> {
  async consume(windows: Window[]): Promise<number> {
    return this.ctx.storage.transaction(async txn => {
      let retry = 0;
      const counts: number[] = [];
      for (const window of windows) {
        const previous = await txn.get<{ start: number; count: number }>(window.name);
        const count = previous?.start === window.start ? previous.count : 0;
        counts.push(count);
        if (count >= window.maximum) retry = Math.max(retry, Math.ceil((window.end - Date.now()) / 1000));
      }
      if (retry) return Math.max(1, retry);
      for (let i = 0; i < windows.length; i++) {
        await txn.put(windows[i].name, { start: windows[i].start, count: counts[i] + 1 });
      }
      // Delete all counters after inactivity; bounded keys per object.
      await txn.setAlarm(Math.max(await txn.getAlarm() ?? 0, Math.max(...windows.map(w => w.end)) + 86400000));
      return 0;
    });
  }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

export async function consume(env: SecurityEnv, key: string, name: string, maximum: number, period: 'minute' | 'day' | 'month'): Promise<void> {
  const now = new Date();
  const duration = period === 'minute' ? 60000 : 86400000;
  const start = period === 'month' ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) : Math.floor(now.getTime() / duration) * duration;
  const end = period === 'month' ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) : start + duration;
  try {
    const retry = await env.SCAN_GUARD.getByName(key).consume([{ name, start, end, maximum }]);
    if (retry) throw new SafeError(period === 'minute' ? 'RATE_LIMITED' : 'SCAN_ALLOWANCE_EXHAUSTED', 429, retry);
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError('LIMITER_UNAVAILABLE', 503);
  }
}

export async function boundedBody(body: ReadableStream<Uint8Array> | null, maximum: number, timeoutMs = 15000): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new SafeError('INVALID_UPLOAD', 400);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new SafeError('UPLOAD_TIMEOUT', 408)); void reader.cancel().catch(() => {}); }, timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { void reader.cancel().catch(() => {}); throw new SafeError('UPLOAD_TOO_LARGE', 413); }
      chunks.push(value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function validateFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const prefix = (...expected: number[]) => expected.every((b, i) => bytes[i] === b);
  const text = new TextDecoder().decode(bytes);
  const mime = prefix(0xff, 0xd8, 0xff) ? 'image/jpeg'
    : prefix(137, 80, 78, 71, 13, 10, 26, 10) ? 'image/png'
    : text.startsWith('%PDF-') ? 'application/pdf'
    : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' ? 'image/webp' : '';
  if (!mime || file.type !== mime) throw new SafeError('UNSUPPORTED_FILE', 415);
  return mime;
}
