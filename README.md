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
- Local receipt-original storage in the app's Documents directory, or direct upload to the user's Google Drive after explicit connection and selection (requires OAuth configuration and a native build).
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

Local receipt features can run in Expo Go. Google Drive requires a native development or release build; see the Google Drive setup below.

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

### Google Drive ? implemented; external OAuth setup required

The provider uses the native `@react-native-google-signin/google-signin` SDK and Drive v3 directly. Its only requested Drive permission is `https://www.googleapis.com/auth/drive.file`: files created by this app or explicitly granted by the user. It never lists the user's whole Drive or requests `drive`/`drive.readonly`. The native SDK also requests its standard sign-in profile scopes; ReceiptMind does not persist the profile, email or ID token. See [Google's scope guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

In **Settings > Original receipt storage**, choose **Connect / reconnect Google Drive**, complete consent, then select **Google Drive** for future saves. Originals upload to that account's My Drive with generated filenames. No shared folder, public sharing permission, service account or ReceiptMind-owned storage is involved. Originals can contain payment information and Google may index their contents; the structured purchase database still goes through the privacy filter and stays encrypted on the device.

The encrypted receipt reference is `gdrive://<opaque-account-id>/<file-id>`. It contains no token. The account ID prevents accidentally using another account's credentials for an old original. Switching providers or disconnecting never rewrites old references. Reconnect the original account to regain access. Opening validates access/trash status through the API and launches a fixed Google Drive viewer URL without a token; the browser/Drive app may require the same account. Missing files, wrong accounts and revoked permission leave structured history intact.

Token renewal stays in Google's native SDK. A Drive 401 invalidates the cached Android token and retries once; the iOS SDK refreshes expired tokens through `getTokens`. Persistent failures ask the user to reconnect. OAuth access/refresh tokens are never written to AsyncStorage, purchase records, logs, URLs or the extraction backend. See the library's [token and sign-out APIs](https://react-native-google-signin.github.io/docs/original).

**Disconnect** attempts to revoke Google authorization and always attempts native sign-out, preserving all originals and history. If revocation fails offline, the app reports that local sign-out completed and tells the user to revoke ReceiptMind from Google Account connections. Device deletion signs out locally without deleting remote files. New saves use local storage when the selected provider is disconnected through Settings.

#### Google Console steps (required outside this repository)

No working OAuth credentials have been supplied or committed. Create the following in your own Google Cloud project:

1. Enable **Google Drive API** in APIs & Services. Configure Google Auth Platform branding, support contact, audience and consent. Add `drive.file` in Data Access. During testing, add the Google accounts you will use as test users. Complete Google's publishing/verification requirements for your audience before production. [Consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent)
2. **Android:** create an OAuth client of application type **Android**, package `com.shameem.receiptmind`, with the SHA-1 of the certificate actually signing the installed app. Register separate clients for debug, EAS/release and Google Play app-signing certificates as needed; an upload-key fingerprint alone is insufficient for Play-signed installs. Get local fingerprints with `gradlew signingReport` in the generated Android project, or use EAS credentials / Play Console App integrity for those builds. Put that build's public Android client ID in `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`. This is a setup gate: the native Android SDK identifies the registered OAuth client using package + signing certificate, so it does **not** accept an `androidClientId` configure parameter. [Android registration details](https://react-native-google-signin.github.io/docs/setting-up/get-config-file)
3. **iOS:** create an OAuth client of application type **iOS** with bundle ID `com.shameem.receiptmind`. Set its public client ID as `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. `app.config.ts` derives the reversed client ID and configures the native URL scheme through the library's Expo plugin. Verify it matches the iOS URL scheme displayed in Console. Rebuild if the client ID changes. [iOS URL scheme setup](https://react-native-google-signin.github.io/docs/setting-up/ios)
4. Copy `.env.example` to an untracked `.env` and fill only the mobile public client IDs. Supply the same variables to native build environments. A client secret, web/server OAuth client, refresh-token backend, Firebase config or shared Drive folder is **not** required by this implementation. Do not create fake values to make the UI appear configured.
5. Run `npm install`, then build with `npx expo run:android` or `npx expo run:ios` (macOS/Xcode required for iOS), or use a configured EAS development/release build. Google Play services must be available on Android. Do not test Drive sign-in in Expo Go: it does not contain the native SDK. Android needs no Firebase Gradle plugin; native module autolinking handles it. The Expo plugin is added when the real iOS client ID is supplied. [Expo native-build setup](https://react-native-google-signin.github.io/docs/setting-up/expo)

`EXPO_PUBLIC_RECEIPT_AI_ENDPOINT` remains the public receipt-extraction Worker endpoint. A URL such as `https://drive.google.com/drive/folders/...` is a Drive UI link, **never a backend/API endpoint or an OAuth client ID**. Drive uploads use fixed Google API URLs inside the provider; they do not use that AI endpoint variable.

#### Save safety and validation

Drive file IDs are reserved before upload, then journaled before the resumable upload starts. This allows rollback after a failed structured write, a lost upload response or process termination. Cleanup only targets the reserved file, not unrelated Drive files. If disconnected/offline, the pending journal remains and **Retry original cleanup** is available after reconnecting. History and export remain usable, while new original saves wait for cleanup. A committed file is retained even if journal removal fails. See [reserved Drive IDs](https://developers.google.com/workspace/drive/api/guides/create-file) and [resumable upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

History-only/device deletion intentionally retains external originals, including any remote upload whose cleanup could not finish; remove those directly in Drive. Receipt deletion removes only the structured record. The provider's delete capability is used for failed-save rollback, not mass deletion of your Drive.

Tests mock Google SDK, HTTP and filesystem boundaries: narrow scopes, cancelled/denied consent, missing configuration, stable references, upload bytes, one-time 401 refresh, revoked access, 403/quota/network errors, wrong accounts, missing/trashed files, disconnect, provider switching, and persistence rollback/restart recovery. Run `node --test tests/*.test.cjs` and `npm run typecheck`.

A real Android/iOS OAuth round trip cannot be verified without your Console registration, signing credentials and native builds. Before release, test sign-in/consent, image/PDF upload/open, token expiry, revocation in Google Account settings, reconnecting the original and a different account, offline rollback, Drive quota failure and local device deletion on both platforms. This package's open-source Original Android sign-in API currently uses Google's deprecated-but-functional legacy SDK; migration to the newer Android authorization SDK is a future native dependency consideration. [Library platform notes](https://react-native-google-signin.github.io/docs/original)

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

1. Complete Google Console registration and validate the implemented Drive provider on signed Android/iOS builds.
2. Configure Apple iCloud container/signing and implement provider.
3. Deploy the included Cloudflare Worker, configure its secret, and add production authentication/rate limiting.
4. For larger datasets, migrate the encrypted blob store to SQLCipher/local SQLite while preserving the same encryption/privacy model.
5. Add authentication, per-user RLS, subscription limits and cost metering.
6. Add test coverage and EAS build profiles for Play Store/TestFlight.

## User-controlled data management

Settings offers a versioned JSON export of structured purchase history (including original references, without original files or the encryption key). Export is explicitly confirmed because the JSON is readable. Its temporary cache file is removed after the native share sheet closes, including on failure, and on the next successful startup after an interruption. Copies shared or saved elsewhere require separate deletion.

- **Delete receipt** in receipt details removes that receipt and its structured items, retaining its original file.
- **Delete purchase history only** removes the encrypted history; all originals and the device encryption key remain.
- **Delete everything from this device** removes encrypted history, all originals in ReceiptMind's local receipt directory (including ones retained after history-only deletion), app cache including picker/camera copies and temporary exports, settings, native provider sessions and the SecureStore encryption key. A durable reset marker blocks normal use until an interrupted deletion is completed.

Google Drive/iCloud originals require separate deletion through those services unless a provider implements deletion. The user-facing history/device deletion actions do not delete external originals; the Drive provider only deletes its reserved uploads during failed-save rollback. Imported source files outside the app and exported copies are not removed.

Unreadable ciphertext, missing keys and malformed structured history show a recovery screen instead of an empty purchase database. Retry after unlocking the device, or explicitly reset history. Writes and exports stay blocked during recovery; reading never generates a replacement key. Storage/save failures keep the previous structured state and offer retry guidance. Mutations are serialized to prevent lost concurrent writes.

Original copies use a pending-reference journal before copying. Failed structured saves roll back the new original; if cleanup fails, saving is blocked and startup/recovery retries cleanup. A committed original is preserved even if clearing the journal fails. The journal contains only an original reference and provider identifier, never decrypted purchase contents, tokens or keys. Drive reserves its reference before upload and retains pending cleanup across restarts; unavailable cloud cleanup does not hide structured history.

A local duplicate warning compares normalized merchant, purchase date, currency and cent-rounded total before copying the original. Users may explicitly save anyway; matching totals on the same day are only a possible duplicate, not proof.

Data-management tests run with `node --test tests/*.test.cjs` and mock native storage, encryption and sharing boundaries. Actual share-sheet behavior, device storage exhaustion, secure-key deletion and Android/iOS file deletion still require device testing.
