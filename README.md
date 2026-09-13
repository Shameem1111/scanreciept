# ReceiptMind (scanreciept)

Privacy-first Expo / React Native mobile prototype for Android and iOS.

## What works now

- Native **Scan Receipt** flow using the device camera.
- Native **Upload Receipt** flow for image/PDF files.
- Confirm and edit merchant, purchase date, total, item names, quantities, line prices and categories; add or remove items before saving.
- Missing or ambiguous dates reach review and require a valid date before save. Low/unknown confidence is highlighted; the extractor provides item confidence only, so receipt fields are marked for confirmation.
- Original item text stays separate from corrections. Item prices are line totals (not unit prices); their sum is calculated in cents, with an explicit option to use it as the confirmed total. The extracted printed total remains separately visible and stored.
- Edited purchase fields are validated and privacy-sanitized again before encrypted persistence.
- Non-itemized receipts and card-payment slips use the printed merchant as one purchase item and the full amount, including cents, as its price. These entries use category Other and reduced confidence for review; payment credentials remain excluded.
- Local receipt-original storage in the app's Documents directory.
- Tap a purchase to see its receipt, extracted item text, categories and original storage provider. Edit saved purchase details without changing the original reference or re-running extraction.
- View original images/PDFs through the Android file viewer or iOS system preview/open sheet. Missing or disconnected originals show "Original receipt unavailable"; structured history remains available and editable.
- AES-GCM encrypted local structured purchase history with search, dashboard and constrained English/German purchase queries.
- Storage-provider selector for **This device / Google Drive / iCloud Drive**.
- Privacy filter and data model intentionally exclude card numbers, IBAN/BIC, bank accounts, terminal IDs, authorization codes and payment references.
- A deployable Cloudflare Worker proxies privacy-aware Gemini receipt extraction without exposing the Gemini key to the mobile app.

The checked-in mobile configuration defaults to the deployed ReceiptMind Cloudflare Worker. `EXPO_PUBLIC_RECEIPT_AI_ENDPOINT` can override that public URL for another environment; AI-provider secrets remain server-side.

## Stack

- Expo SDK 57 / React Native 0.86.3
- TypeScript 6.0 (Expo-aligned)
- `expo-image-picker` for camera scanning
- `expo-document-picker` for uploads
- `expo-file-system` for local receipt originals
- AES-GCM encrypted local structured purchase history (`expo-crypto`), with the encryption key protected by `expo-secure-store`
- Cloudflare Worker + Gemini for optional receipt extraction

## Run locally

Requires Node.js 22.13+ for Expo SDK 57.

```bash
npm install
npx expo start
```

Then scan the QR code with Expo Go on Android/iOS, or press `a` / `i` when an emulator/simulator is available.

Keep dependencies aligned with the installed Expo SDK using `npx expo install --fix`, then run `npx expo-doctor`. React Native 0.86.3 includes Hermes `250829098.0.17`, replacing the affected `250829098.0.14` runtime. SDK 57 uses the New Architecture without the removed `newArchEnabled` configuration field. Rebuild existing native app binaries after updating these dependencies.

Validate project health with:

```bash
npm install
npm run typecheck
node --test tests/*.test.cjs
npx expo-doctor
```

## Browse purchase memory

The **Purchases** tab searches normalized names and printed `originalText` while showing both separately. Use the bottom **Filters & sort** button for merchant, item category, inclusive date bounds, newest/oldest/lowest/highest line-price sorting, and receipt or product grouping. Blank date bounds are open-ended; invalid or reversed ranges show an error. Groups follow their first row in the selected sort, and rows retain that sort within each group. Every purchase row opens receipt details, even if the original file is unavailable.

**Price history & cheapest previous** opens all saved purchases of the selected normalized product, independent of browse filters, oldest first. Product identity ignores case and repeated whitespace but does not infer aliases, translations or package equivalence. Cheapest previous compares integer-cent line totals strictly before the selected purchase date, excludes same-day purchases whose order is unknown, and shows all ties with receipt links. Quantities remain visible; these are not unit-price comparisons. All filtering and calculations run locally without AI or persistence changes.

## Ask purchase history

Ask uses reusable typed parsing and execution services (`src/services/purchaseQuery*.ts`), entirely on-device. It supports `sum`, `list`, `find_receipt`, `price_history`, `cheapest` and `last_purchase`, with intersecting product, merchant, category, inclusive date-range and calendar-month filters. No purchase history is sent to AI; no generated SQL is executed. Answers show the interpreted filters and supporting merchant/date/price rows. Tap a row to open receipt details, including when its original file is unavailable. Results refresh after receipt edits and show more evidence on demand.

Examples:

- `How much did I spend on food in August 2026?`
- `Wie viel habe ich für Lebensmittel im August 2026 ausgegeben?`
- `Show purchases from REWE between 2026-08-01 and 2026-08-31`
- `Zeige Einkäufe bei REWE vom 01.08.2026 bis 31.08.2026`
- `Find receipt for milk` / `Finde den Beleg für Milch`
- `Price history for milk` / `Preisverlauf für Milch`
- `Cheapest milk` / `Günstigster Kauf von Milch`
- `When did I last buy milk?` / `Wann habe ich zuletzt Milch gekauft?`

Product matching checks words in corrected names and original item text, ignoring case and normalizing German umlauts. It does not infer translations or equivalent package sizes. Put a product in double quotes if its name contains category or query words. Merchants use `at/from` or `bei/von`; categories accept English and German names. Dates accept `YYYY-MM-DD` or `DD.MM.YYYY`; named months without a year use the current local year, shown in the answer. `This month` / `diesen Monat` and `last month` / `letzten Monat` are supported. Ambiguous dates, negation, multiple categories and unsupported time expressions prompt guidance instead of silently widening the search.

Arithmetic uses integer cents. Unfiltered or merchant/date-only sums use confirmed receipt totals once per receipt. Product/category sums use matching item line totals without multiplying quantities again. Cheapest compares line totals and includes all ties; price history is oldest first and displays quantities. Neither claims unit-price equivalence. Last purchase returns every match on the latest purchase date because exact purchase times are not recorded. Receipt searches deduplicate supporting receipts and display full receipt totals.

Questions containing payment/banking information are rejected and redacted before being added to chat messages. Query evidence uses an allowlist of purchase fields and applies the central privacy filter; chat is not persisted and existing encrypted receipt persistence is unchanged.

## Real AI extraction

Do not put a Gemini/OpenAI secret in Expo environment variables. Deploy the included Worker from `backend/receiptmind-worker`, add `GEMINI_API_KEY` as a Cloudflare encrypted secret, and set:

```bash
EXPO_PUBLIC_RECEIPT_AI_ENDPOINT=https://receiptmind-api.r7tg4t4tcc.workers.dev/receipt/extract
```

For Cloudflare Git deployment, use `/backend/receiptmind-worker` as the project path, leave the build command blank, and use `npx wrangler deploy` as the deploy command. See [`backend/receiptmind-worker/README.md`](backend/receiptmind-worker/README.md) for setup details.

The endpoint accepts multipart field `receipt` and returns JSON shaped like:

```json
{
  "merchant": "REWE",
  "purchaseDate": "2026-09-13",
  "total": 16.67,
  "currency": "EUR",
  "source": "ai",
  "items": [
    {
      "id": "item-1",
      "originalText": "BIO BANANEN",
      "name": "Organic Bananas",
      "category": "Food",
      "quantity": 1,
      "price": 2.49,
      "confidence": 0.98
    }
  ]
}
```

The backend uses a strict output schema, explicitly prohibits payment credential and banking fields, and sanitizes returned merchant/item text. The mobile client applies a second privacy filter before persistence. The Worker does not store original receipt files.

## Storage providers

### Local — implemented

Receipt originals are copied to the app's document storage under `ReceiptMind/Receipts`.

The storage-provider interface includes `isAvailable(reference?)` and `openReceipt(reference)`. Screens use service-level helpers with the receipt's saved provider, independent of the currently selected provider. Local references are resolved within the current app Documents directory (including older iOS container paths). Android grants temporary read access through a content URI; iOS uses `expo-sharing`. Rebuild custom native clients after installing `expo-intent-launcher` and `expo-sharing`. Opening requires a compatible native viewer; web opening is not supported.

Receipt updates pass through the existing review validation/payment filter and encrypted store. Original availability is never used to prune structured history, and a failed encrypted write leaves the previous record intact.

### Google Drive — adapter placeholder

Automatic Google Drive upload needs Google OAuth client IDs and Drive `drive.file` authorization. It is deliberately not faked in this commit. Add a provider implementation in `src/services/storage.ts` once OAuth is configured.

### iCloud Drive — capability scaffolded

`app.json` declares `ios.usesIcloudStorage` and configures `expo-document-picker`. Final automatic iCloud Drive writing requires Apple Developer signing/container configuration. Until then the provider remains marked Setup in the UI.

## Privacy model

- No database columns for card numbers, IBANs, BICs, bank accounts, terminal IDs, authorization codes or payment references.
- Sensitive-looking payment lines are rejected by both the extraction backend and client sanitizer.
- Original receipts are not stored by the ReceiptMind backend.
- No AI secret is shipped in the mobile binary or committed to GitHub.
- For production, add authentication and rate limiting, and use AI provider terms appropriate for receipt privacy.
- If structured records later move to a backend, use per-user row-level access, encryption, and GDPR-compliant retention/deletion policies.

## Production next steps

1. Configure Google OAuth + Drive `drive.file` provider.
2. Configure Apple iCloud container/signing and implement provider.
3. Deploy the included Cloudflare Worker, configure its secret, and add production authentication/rate limiting.
4. For larger datasets, migrate the encrypted blob store to SQLCipher/local SQLite while preserving the same encryption/privacy model.
5. Add authentication, per-user RLS, subscription limits and cost metering.
6. Add test coverage and EAS build profiles for Play Store/TestFlight.
