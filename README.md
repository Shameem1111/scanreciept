# ReceiptMind (scanreciept)

Privacy-first Expo / React Native mobile prototype for Android and iOS.

## What works now

- Native **Scan Receipt** flow using the device camera.
- Native **Upload Receipt** flow for image/PDF files.
- Review extracted merchant, date, line items, categories and prices.
- Local receipt-original storage in the app's Documents directory.
- AES-GCM encrypted local structured purchase history with search, dashboard and simple question answering.
- Storage-provider selector for **This device / Google Drive / iCloud Drive**.
- Privacy filter and data model intentionally exclude card numbers, IBAN/BIC, bank accounts, terminal IDs, authorization codes and payment references.
- A secure AI endpoint hook is ready. No AI secret/API key is embedded in the app.

When `EXPO_PUBLIC_RECEIPT_AI_ENDPOINT` is empty the app uses demo extraction so the complete mobile flow can be tested without an API key.

## Stack

- Expo SDK 57 / React Native 0.86
- TypeScript
- `expo-image-picker` for camera scanning
- `expo-document-picker` for uploads
- `expo-file-system` for local receipt originals
- AES-GCM encrypted local structured purchase history (`expo-crypto`), with the encryption key protected by `expo-secure-store`

## Run locally

Requires Node.js 22.13+ for Expo SDK 57.

```bash
npm install
npx expo start
```

Then scan the QR code with Expo Go on Android/iOS, or press `a` / `i` when an emulator/simulator is available.

## Real AI extraction

Do not put a Gemini/OpenAI secret in Expo environment variables. Instead deploy a secure backend endpoint and set:

```bash
EXPO_PUBLIC_RECEIPT_AI_ENDPOINT=https://your-backend.example.com/receipt/extract
```

The endpoint should accept multipart field `receipt` and return JSON shaped like:

```json
{
  "merchant": "REWE",
  "purchaseDate": "2026-09-13",
  "total": 16.67,
  "currency": "EUR",
  "source": "ai",
  "items": [
    {
      "id": "1",
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

The backend prompt/schema should explicitly prohibit extracting any payment credential or banking field. The mobile client additionally sanitizes returned merchant/item text and drops lines matching payment-data patterns.

## Storage providers

### Local — implemented

Receipt originals are copied to the app's document storage under `ReceiptMind/Receipts`.

### Google Drive — adapter placeholder

Automatic Google Drive upload needs Google OAuth client IDs and Drive `drive.file` authorization. It is deliberately not faked in this commit. Add a provider implementation in `src/services/storage.ts` once OAuth is configured.

### iCloud Drive — capability scaffolded

`app.json` declares `ios.usesIcloudStorage` and configures `expo-document-picker`. Final automatic iCloud Drive writing requires Apple Developer signing/container configuration. Until then the provider remains marked Setup in the UI.

## Privacy model

- No database columns for card numbers, IBANs, BICs, bank accounts, terminal IDs, authorization codes or payment references.
- Sensitive-looking payment lines are rejected by the client sanitizer.
- Original receipts are not uploaded to ReceiptMind storage by default.
- No AI secret is shipped in the mobile binary.
- For production, move structured records to a properly secured backend/Supabase with per-user row-level access, encryption and GDPR-compliant retention/deletion policies.

## Production next steps

1. Configure Google OAuth + Drive `drive.file` provider.
2. Configure Apple iCloud container/signing and implement provider.
3. Deploy secure receipt extraction backend using a low-cost multimodal model.
4. For larger datasets, migrate the encrypted blob store to SQLCipher/local SQLite while preserving the same encryption/privacy model.
5. Add authentication, per-user RLS, subscription limits and cost metering.
6. Add test coverage and EAS build profiles for Play Store/TestFlight.
