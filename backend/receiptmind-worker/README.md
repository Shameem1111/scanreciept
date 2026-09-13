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

The backend deliberately excludes and filters payment cards, masked card numbers, IBAN/BIC, bank accounts, authorization codes, payment references, and terminal/processor identifiers. The mobile client applies a second privacy filter before persistence.
