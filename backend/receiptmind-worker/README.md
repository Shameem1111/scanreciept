# ReceiptMind receipt API

The Worker authenticates Google users before reading receipt bytes, limits requests and scans, calls Gemini, and returns sanitized purchase-memory fields. Gemini credentials exist only in Cloudflare secrets. Deployment is **manual**; see [DEPLOYMENT.md](DEPLOYMENT.md). Scans default to disabled.

## Request contract and authentication

- `GET /health`: liveness only, not credential/readiness validation.
- `POST /receipt/extract`: `Authorization: Bearer <Google ID token>`, multipart field `receipt`, optional `privacy_mode=no-payment-data`.
- `OPTIONS /receipt/extract`: approved browser preflight only. No cookie authentication.

The public Web OAuth client ID is the token audience. Google public keys verify RS256 signatures; issuer, audience, subject, issue time and expiry are checked. Tokens older than one hour are rejected. Only public keys are cached with bounded refresh; tokens/profiles are not. Never send Drive access tokens or a client-selected user ID. See [Google verification requirements](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

The mobile app retrieves an ID token from the existing native Google SDK before each upload. First scan can open Google consent; cancellation sends no receipt. Receipt sign-in requests no Drive permission; connecting Drive separately requests `drive.file`. Tokens remain with the native SDK and request memory, never AsyncStorage. Settings offers local sign-out. Existing issued tokens remain usable until expiry; this is not immediate server-side revocation or hardware app attestation. Native OAuth signing registration and audience validation identify the intended app client; a shared Expo secret would not provide that protection.

## Limits and allowances

`SCAN_GUARD` is a SQLite Durable Object namespace, one object per HMAC-pseudonymized user or IP. Transactions reserve counters atomically across regions/concurrent requests and survive isolate restarts. Missing/broken bindings fail closed.

| Setting | Default | Meaning |
| --- | --- | --- |
| USER_REQUESTS_PER_MINUTE | 6 | All authenticated extraction requests, including invalid uploads |
| IP_REQUESTS_PER_MINUTE | 30 | All extraction requests, including missing/invalid authentication |
| USER_SCANS_PER_MONTH | 50 | Reserved scans per Google subject, UTC calendar month |
| IP_SCANS_PER_DAY | 200 | Reserved scans per ingress IP, UTC day |
| SCANS_ENABLED | false | Only literal `true` enables provider calls |

Limits must be integers from 0 to 1,000,000; zero denies all. Fixed windows permit bursts across boundaries. Only Cloudflare's `CF-Connecting-IP` is used, never forwarded headers or payloads. Do not expose the handler through an untrusted proxy that can supply that header. Shared networks share an IP allowance. Distributed multi-account/multi-IP abuse still requires edge controls and provider project quotas. Paid subscription entitlement management is separate; all users receive the configured allowance.

Invalid uploads do not consume scans. Valid uploads reserve IP then user scans before provider work. Failures, timeouts and unreadable receipts consume reservations because uncertain work can incur cost. An IP reservation may be consumed when user quota is exhausted. This conservative cross-object behavior prevents overspending. Each reservation permits at most two provider attempts (only transient 5xx receives one retry). The client never automatically retries; repeated scans consume new allowances.

Objects store only window start/count pairs and cleanup alarms, with at most two keys each. All state expires after the latest window end plus one day of inactivity (roughly 32 days maximum for users). Active objects overwrite old windows. HMAC rotation resets effective allowances: rotate intentionally, not per deployment. See [Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## Upload validation and retention

JPEG, PNG, WebP and PDF are accepted, non-empty and at most 10 MiB. Declared MIME must match the file signature; extensions are not trusted. This is signature validation, not a full decoder, antivirus scan or PDF page-count check. Files are never executed or served as uploaded documents.

The multipart stream is bounded to 10 MiB + 64 KiB even without Content-Length, with a 15-second read deadline. Duplicate files, unknown fields, compressed bodies and malformed multipart are rejected. Provider output is capped at 1 MiB and 8,192 output tokens, with the existing 45-second overall provider timeout. Receipt instructions are treated as data; schema enforcement and backend/client payment-data filtering remain intact. German/English extraction and review of uncertain results are preserved.

No receipt, filename, prompt, extraction JSON, raw exception, token, email, subject or raw IP is written to application logs, Durable Objects, R2, KV, D1, queues, caches or Gemini Files API. Responses use `no-store`; inline receipt bytes go directly to Gemini. Memory is released with request completion, including failure; JavaScript does not guarantee cryptographic memory erasure. User-selected original storage and encrypted local history are unchanged.

**Google retention is separate:** the Gemini Developer API may retain prompts/responses for abuse monitoring even on paid service. This endpoint has no flag that disables that policy. Do not call this end-to-end zero retention. If that is required for release, keep scanning disabled and provision a suitable Vertex AI arrangement and implement its authentication/endpoint first. See [Google's retention guidance](https://ai.google.dev/gemini-api/docs/zdr).

## CORS

`ALLOWED_ORIGINS` is a comma-separated exact origin allowlist, empty by default (native-only). Native requests without Origin still require authentication and limits. `null`, wildcard and unlisted browser origins are denied. Approved origins receive their own origin, `Vary: Origin`, and POST/OPTIONS with Accept, Content-Type and Authorization. Non-browser scripts can omit Origin: CORS is not authentication.

## Usage and estimated cost

One structured `receipt_request` log records requestCount, HTTP status/code, duration, configured model, optional user HMAC, provider attempts, reported input/output tokens, usage availability, unmetered attempts and estimated USD. No receipt-derived dimensions are included. Invocation logs are disabled and trace sampling is zero to avoid automatic URL metadata; application logs are sampled at 100%. Do not enable external body/header capture.

Set `INPUT_USD_PER_MILLION` and `OUTPUT_USD_PER_MILLION` to current model prices before enabling scans. Cost is `(inputTokens * inputPrice + (candidateTokens + thoughtTokens) * outputPrice) / 1,000,000`. Cached input uses full input price conservatively. Missing usage produces null cost, not zero. `unmeteredAttempts` identifies retries/errors/timeouts with unknown usage; reconcile with provider billing. Estimates exclude Cloudflare charges, discounts and pricing tiers.

Filter Workers Logs by `event=receipt_request`; sum requestCount, providerAttempts, inputTokens, outputTokens and estimatedCostUsd by day/model. Alert on unmeteredAttempts, denials and provider errors. Logs are operational telemetry, not an exactly-once billing ledger; platform delivery and retention apply. Restrict dashboard access and choose the shortest useful log retention.

## Stable errors

Application failures return `{code, error}` with fixed privacy-safe messages. Rate/quota failures include `Retry-After`; 401 includes `WWW-Authenticate: Bearer`.

| HTTP | Codes |
| --- | --- |
| 400 / 408 / 413 / 415 | INVALID_UPLOAD, UPLOAD_TIMEOUT, UPLOAD_TOO_LARGE, UNSUPPORTED_FILE |
| 401 | AUTH_REQUIRED, AUTH_INVALID |
| 403 / 404 / 405 | ORIGIN_DENIED, CORS_DENIED, NOT_FOUND, METHOD_NOT_ALLOWED |
| 429 | RATE_LIMITED, SCAN_ALLOWANCE_EXHAUSTED, PROVIDER_QUOTA |
| 422 / 502 | UNREADABLE_RECEIPT, INVALID_AI_RESPONSE |
| 503 | AUTH_UNAVAILABLE, LIMITER_UNAVAILABLE, SCANS_DISABLED, SERVICE_CONFIG, CLIENT_ADDRESS_UNAVAILABLE, INTERNAL_ERROR, PROVIDER_AUTH, PROVIDER_CONFIG, PROVIDER_UNAVAILABLE |
| 504 | PROVIDER_TIMEOUT |

Cloudflare edge rejection/runtime termination may occur before application code and is outside this JSON contract. The mobile client uses safe fallback messages.

## Verification

Worker: `npm ci`, `npm run types`, `npm run typecheck`, `npm test`, `npx wrangler deploy --dry-run`. Runtime tests use real RSA verification and local Durable Object storage; only Google/Gemini network calls are mocked.

Repository root: `npm run typecheck` and `node --test tests/*.test.cjs`. Tests cover token transport/failures, upload, privacy, review, encryption and original storage. Native consent/token renewal requires signed Android/iOS device testing; mocked OCR does not establish real extraction accuracy.
