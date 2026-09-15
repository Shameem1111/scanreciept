import { verifySignIn, boundedBody, consume, identity, limit, SafeError, validateFile } from './security';
import { extractReceipt, ExtractionError, type Env, type Usage } from './index';

function price(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value ?? '') || !Number.isFinite(Number(value))) throw new SafeError('SERVICE_CONFIG', 503);
  return Number(value);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const started = Date.now();
  const usage: Usage = { providerAttempts: 0, inputTokens: 0, outputTokens: 0, usageReported: false };
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let user: string | undefined;
  let inputPrice = 0;
  let outputPrice = 0;
  const origin = request.headers.get('origin');
  const allowed = !origin || (origin !== 'null' && (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).includes(origin));
  function reply(body: unknown, responseStatus = 200, retry?: number): Response {
    status = responseStatus;
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
      'Access-Control-Allow-Headers': 'Accept, Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'Retry-After' });
    if (origin && allowed) headers.set('Access-Control-Allow-Origin', origin);
    if (retry) headers.set('Retry-After', String(retry));
    if (status === 401) headers.set('WWW-Authenticate', 'Bearer');
    return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  }
  try {
    const url = new URL(request.url);
    const sessionRequest = url.pathname === '/receipt/session';
    if (!allowed) throw new SafeError('ORIGIN_DENIED', 403);
    if (url.pathname !== '/receipt/extract' && url.pathname !== '/health' && !sessionRequest) throw new SafeError('NOT_FOUND', 404);
    if (request.method === 'OPTIONS') {
      if ((url.pathname !== '/receipt/extract' && !sessionRequest) || request.headers.get('access-control-request-method') !== 'POST' ||
        (request.headers.get('access-control-request-headers') ?? '').split(',').some(h => h.trim() && !['accept', 'content-type', 'authorization'].includes(h.trim().toLowerCase()))) throw new SafeError('CORS_DENIED', 403);
      code = 'OK'; return reply(null, 204);
    }
    if (request.method === 'GET' && url.pathname === '/health') { code = 'OK'; return reply({ ok: true, service: 'receiptmind-api' }); }
    if (request.method !== 'POST' || (url.pathname !== '/receipt/extract' && !sessionRequest)) throw new SafeError('METHOD_NOT_ALLOWED', 405);
    // Cloudflare sets this at ingress. Never trust X-Forwarded-For.
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip) throw new SafeError('CLIENT_ADDRESS_UNAVAILABLE', 503);
    const ipKey = await identity(env, 'ip', ip);
    await consume(env, ipKey, 'requests', limit(env.IP_REQUESTS_PER_MINUTE), 'minute');
    const signIn = await verifySignIn(request, env);
    user = await identity(env, 'user', signIn.identity);
    await consume(env, user, 'requests', limit(env.USER_REQUESTS_PER_MINUTE), 'minute');
    if (env.SCANS_ENABLED !== 'true') throw new SafeError('SCANS_DISABLED', 503);
    if (!env.GEMINI_API_KEY?.trim()) throw new SafeError('PROVIDER_CONFIG', 503);
    inputPrice = price(env.INPUT_USD_PER_MILLION);
    outputPrice = price(env.OUTPUT_USD_PER_MILLION);
    if (sessionRequest) { code = 'OK'; return reply({ expiresAt: signIn.expiresAt }); }
    const contentType = request.headers.get('content-type') ?? '';
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType) || request.headers.has('content-encoding')) throw new SafeError('INVALID_UPLOAD', 400);
    const maximum = 10 * 1024 * 1024 + 64 * 1024;
    const length = request.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new SafeError('UPLOAD_TOO_LARGE', 413);
    const bytes = await boundedBody(request.body, maximum);
    let form: FormData;
    try { form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData(); }
    catch { throw new SafeError('INVALID_UPLOAD', 400); }
    const entry = form.get('receipt');
    if (!(entry instanceof File) || !entry.size || form.getAll('receipt').length !== 1 ||
      [...form.keys()].some(k => !['receipt', 'privacy_mode'].includes(k)) || form.getAll('privacy_mode').length > 1 ||
      (form.has('privacy_mode') && form.get('privacy_mode') !== 'no-payment-data')) throw new SafeError('INVALID_UPLOAD', 400);
    if (entry.size > 10 * 1024 * 1024) throw new SafeError('UPLOAD_TOO_LARGE', 413);
    const mime = await validateFile(entry);
    // Reserve before provider work. Failed/uncertain calls can incur cost, so
    // never refund them. Cross-identity reservations are deliberately conservative.
    await consume(env, ipKey, 'scans', limit(env.IP_SCANS_PER_DAY), 'day');
    await consume(env, user, 'scans', limit(env.USER_SCANS_PER_MONTH), 'month');
    const result = await extractReceipt(entry, mime, env, usage);
    code = 'OK'; return reply(result);
  } catch (error) {
    if (error instanceof SafeError || error instanceof ExtractionError) {
      code = error.code;
      return reply({ code, error: error.message }, error.status, error instanceof SafeError ? error.retryAfter : undefined);
    }
    return reply({ code, error: 'Receipt request could not be completed.' }, 503);
  } finally {
    // Explicit allowlist: no URL, IP, token, filename, exception, prompt or result.
    console.log(JSON.stringify({ event: 'receipt_request', requestCount: 1, status, code,
      user, durationMs: Date.now() - started, model: env.GEMINI_MODEL || 'gemini-2.5-flash-lite', ...usage,
      estimatedCostUsd: usage.usageReported ? (usage.inputTokens * inputPrice + usage.outputTokens * outputPrice) / 1000000 : null,
      unmeteredAttempts: usage.providerAttempts - (usage.usageReported ? 1 : 0) }));
  }
}
