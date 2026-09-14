# Manual deployment runbook

No deployment is part of this implementation task. Pushing `main` must not publish the Worker. Disable automatic builds in Cloudflare before enabling production releases. The checked-in Wrangler custom build rejects Workers Builds/CI environments before upload, including the previously documented direct `npx wrangler deploy` command. A git-triggered build may therefore show an intentional failure. Keep this guard in place.

## Required bindings, secrets and public settings

- Cloudflare Worker `receiptmind-api`, with SQLite Durable Objects support.
- `SCAN_GUARD` binding, class `ScanGuard`, migration `v1-scan-guard` with `new_sqlite_classes`. Wrangler creates the namespace on the first approved deployment. Preserve migration history. No KV/D1/R2 resources are needed.
- Cloudflare secrets: `GEMINI_API_KEY` (provider credential) and `ABUSE_HASH_KEY` (at least 32 characters, generated from at least 32 cryptographically random bytes). Set through secure dashboard/interactive CLI input only. Never include values in command arguments, Git, Expo, screenshots or logs. Keep the HMAC key stable across releases.
- Public `GOOGLE_WEB_CLIENT_ID`, `GEMINI_MODEL`, `ALLOWED_ORIGINS`, request/scan limits, prices and `SCANS_ENABLED` in `wrangler.toml`. Empty OAuth/pricing fails closed. Set current prices for the selected model; update both when changing models.
- A public Web OAuth client ID in the same Google project as the Android/iOS clients. No Web client secret is needed. Configure consent/publishing, Android package/signing SHA-1 and iOS bundle/URL scheme as described in the root README. Set Expo `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` equal to Worker `GOOGLE_WEB_CLIENT_ID`; preserve mobile client IDs. Build a native app; Expo Go lacks the SDK.
- `ALLOWED_ORIGINS=""` supports current native clients. For a future supported web sign-in client, list its exact HTTPS origin with no path/trailing slash. No wildcard or `null`.

## Provider release prerequisite

Review [Gemini retention](https://ai.google.dev/gemini-api/docs/zdr). Cloudflare code retains no receipts but cannot eliminate Google's abuse-monitoring retention. If strict end-to-end non-retention is required, **keep `SCANS_ENABLED=false`** and implement a provider arrangement that guarantees it; a Worker flag cannot change Developer API policy.

Use a dedicated provider project, restrict its key to the required API, configure conservative provider quotas and billing alerts, and disable optional prompt logging/data sharing. Billing alerts are not a hard spending cap. Account/IP allowances do not prevent distributed multi-account abuse. Configure appropriate Cloudflare WAF/DDoS controls on a custom domain when needed; CORS is not bot protection. Never embed an Access service secret in Expo.

## Operator release steps (separate from implementation)

1. Disable automatic Cloudflare/GitHub deployment triggers. Use a local operator shell outside CI. Confirm the account with `npx wrangler whoami`; authenticate using `npx wrangler login` if needed.
2. In `backend/receiptmind-worker`, run `npm ci`. Configure public settings and leave `SCANS_ENABLED=false` for initial rollout. Run `npm run types`, `npm run typecheck`, `npm test`, and `npx wrangler deploy --dry-run`.
3. Provision secrets through the encrypted secret UI or interactive `npx wrangler secret put GEMINI_API_KEY` and `npx wrangler secret put ABUSE_HASH_KEY`. **Secret put can create and deploy a new version immediately**, so do this only in the approved release window. To stage secrets instead, use the [versioned secret workflow](https://developers.cloudflare.com/workers/configuration/secrets/) and deliberately deploy the reviewed version. Never print values or paste them into a committed file.
4. Run `npm run deploy` when ready to publish the protected Worker and migration. Ensure that version contains both secrets. Old unauthenticated app versions will receive 401; distribute the updated native app with the matching OAuth audience.
5. Verify health, missing/invalid tokens, denied origins, native sign-in/cancellation, expiry/renewal and local sign-out. Use synthetic receipts only. Confirm counters and metadata logs; health alone does not establish readiness.
6. After provider-retention, quota and pricing review, set `SCANS_ENABLED=true`, regenerate types, rerun checks and manually deploy. Test one synthetic extraction and verify usage/cost with no receipt logs. Exercise rate/quota exhaustion in a dedicated staging Worker first. Staging needs separate secrets, OAuth settings and a separate namespace; environment bindings/vars are not automatically inherited.
7. Verify original storage and encrypted history on signed Android/iOS devices, including users who never grant Drive access. Alert on errors, unmetered attempts and abnormal provider usage.

Pause scans by setting `SCANS_ENABLED=false` and manually deploying. Do not roll back to the unauthenticated implementation. Code rollback does not restore Durable Object state. Rotating `ABUSE_HASH_KEY` resets effective identities/allowances and is not a quota workaround. Lowering limits applies to current windows immediately.

Local development can use an ignored `.dev.vars` with development secrets; never use production receipts. `npm run dev` does not upload these secrets. Keep tests local: no remote bindings, production credentials or live provider calls.
