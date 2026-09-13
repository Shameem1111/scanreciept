# ReceiptMind Cloudflare Worker

Privacy-aware receipt extraction endpoint for the ReceiptMind mobile app. The Worker accepts a receipt temporarily, sends it to Gemini, validates and sanitizes the structured result, and returns only purchase-memory fields. It does not store the uploaded receipt.

## Cloudflare Git configuration

Use these settings when connecting `Shameem1111/scanreciept`:

```text
Project name: receiptmind-api
Production branch: main
Build command: (leave blank)
Deploy command: npx wrangler deploy
Path: /backend/receiptmind-worker
```

Keep Cloudflare Access disabled for the mobile endpoint. Add production authentication and Cloudflare rate limiting before opening the service to general users.

## Required secret

In Cloudflare, open the Worker and add an encrypted secret named `GEMINI_API_KEY` under **Settings > Variables and Secrets**. Never add this key to Expo environment variables or GitHub.

For CLI deployment:

```bash
npm install
npx wrangler secret put GEMINI_API_KEY
npm run typecheck
npm run deploy
```

For local development, create an untracked `.dev.vars` file inside this directory:

```text
GEMINI_API_KEY=your-local-development-key
```

Then run `npm run dev`. Do not commit `.dev.vars`.

## Endpoints

- `GET /health` returns a non-sensitive health response.
- `POST /receipt/extract` accepts multipart form data with a `receipt` file.

Accepted formats are JPEG, PNG, WebP, and PDF up to 10 MB. The response matches the mobile app's receipt extraction schema.

Receipt reading supports German, English, and mixed-language receipts automatically. The prompt preserves printed item text and its language, recognizes German decimal commas and date formats, and returns numerical amounts and ISO dates. Currency support remains EUR. These instructions and response handling are covered by mocked-provider tests; real OCR accuracy must also be checked with representative receipts.

## Extraction failures

Deploy backend changes with `npm run deploy` after authenticating using `npx wrangler login`. Reloading Expo alone does not update the live Worker.

Errors return a safe `code` and `error` message. The mobile app maps known codes to actionable messages without displaying raw provider output:

| Code | Next step |
| --- | --- |
| `PROVIDER_AUTH` | Check the Worker's Gemini secret and provider permissions. |
| `PROVIDER_CONFIG` | Check the secret, model availability, and request configuration. |
| `PROVIDER_QUOTA` | Check Gemini quota/billing; retry after the limit resets. |
| `PROVIDER_UNAVAILABLE` | Retry shortly; temporary provider 5xx responses receive one automatic retry. |
| `PROVIDER_TIMEOUT` | Retry; the provider request has a 45-second overall timeout. |
| `INVALID_AI_RESPONSE` | Retry; the model did not return parseable structured output. |
| `UNREADABLE_RECEIPT` | Supply a clearer complete receipt showing the date and items. |

Worker logs record only the failed provider HTTP status, never API keys, provider response bodies, or receipt contents. An old deployed Worker may still return generic 502 errors until redeployed. Its `/health` endpoint only confirms the Worker is running, not that Gemini credentials/quota are working.

Run regression tests from the repository root using `node --test tests/*.test.cjs`, and typecheck both the app and this Worker with their respective `npm run typecheck` commands.

The backend deliberately excludes and filters payment cards, masked card numbers, IBAN/BIC, bank accounts, authorization codes, payment references, and terminal/processor identifiers. The mobile client applies a second privacy filter before persistence.
