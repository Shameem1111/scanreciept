# ReceiptMind (scanreciept)

Privacy-first Expo / React Native mobile prototype for Android and iOS.

## What works now

- Native **Scan Receipt** flow using the device camera.
- Native **Upload Receipt** flow for image/PDF files.
- Scanned or uploaded receipts are read automatically by the configured extraction service, then shown for review without an extra reading confirmation.
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
- An authenticated Cloudflare Worker verifies Google ID tokens, applies persistent per-user/IP limits and scan allowances, and meters Gemini usage without logging receipts. See [Worker security and setup](backend/receiptmind-worker/README.md) and [manual deployment](backend/receiptmind-worker/DEPLOYMENT.md).

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

Local receipt features can run in Expo Go. Google Drive and iCloud require a native development or release build; see the Google Drive setup below.

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

Do not put a Gemini/OpenAI secret in Expo environment variables. Follow the separate [manual Worker deployment guide](backend/receiptmind-worker/DEPLOYMENT.md) to configure authentication, secrets, allowances and pricing. The endpoint URL remains public:

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
4. Copy `.env.example` to an untracked `.env` and fill only the mobile public client IDs. Supply the same variables to native build environments. Receipt sign-in also requires a public Web OAuth client ID: set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and matching Worker `GOOGLE_WEB_CLIENT_ID`. No client secret, refresh-token backend, Firebase config or shared Drive folder is needed. Do not create fake values to make the UI appear configured.
5. Run `npm install`, then build with `npx expo run:android` or `npx expo run:ios` (macOS/Xcode required for iOS), or use a configured EAS development/release build. Google Play services must be available on Android. Do not test Drive sign-in in Expo Go: it does not contain the native SDK. Android needs no Firebase Gradle plugin; native module autolinking handles it. The Expo plugin is added when the real iOS client ID is supplied. [Expo native-build setup](https://react-native-google-signin.github.io/docs/setting-up/expo)

`EXPO_PUBLIC_RECEIPT_AI_ENDPOINT` remains the public receipt-extraction Worker endpoint. A URL such as `https://drive.google.com/drive/folders/...` is a Drive UI link, **never a backend/API endpoint or an OAuth client ID**. Drive uploads use fixed Google API URLs inside the provider; they do not use that AI endpoint variable.

#### Save safety and validation

Drive file IDs are reserved before upload, then journaled before the resumable upload starts. This allows rollback after a failed structured write, a lost upload response or process termination. Cleanup only targets the reserved file, not unrelated Drive files. If disconnected/offline, the pending journal remains and **Retry original cleanup** is available after reconnecting. History and export remain usable, while new original saves wait for cleanup. A committed file is retained even if journal removal fails. See [reserved Drive IDs](https://developers.google.com/workspace/drive/api/guides/create-file) and [resumable upload protocol](https://developers.google.com/workspace/drive/api/guides/manage-uploads).

History-only/device deletion intentionally retains external originals, including any remote upload whose cleanup could not finish; remove those directly in Drive. Receipt deletion removes only the structured record. The provider's delete capability is used for failed-save rollback, not mass deletion of your Drive.

Tests mock Google SDK, HTTP and filesystem boundaries: narrow scopes, cancelled/denied consent, missing configuration, stable references, upload bytes, one-time 401 refresh, revoked access, 403/quota/network errors, wrong accounts, missing/trashed files, disconnect, provider switching, and persistence rollback/restart recovery. Run `node --test tests/*.test.cjs` and `npm run typecheck`.

A real Android/iOS OAuth round trip cannot be verified without your Console registration, signing credentials and native builds. Before release, test sign-in/consent, image/PDF upload/open, token expiry, revocation in Google Account settings, reconnecting the original and a different account, offline rollback, Drive quota failure and local device deletion on both platforms. This package's open-source Original Android sign-in API currently uses Google's deprecated-but-functional legacy SDK; migration to the newer Android authorization SDK is a future native dependency consideration. [Library platform notes](https://react-native-google-signin.github.io/docs/original)

### iCloud Drive ? implemented; signed iPhone validation required

The provider in `src/services/icloud.ts` uses the app-local Expo module in `modules/receiptmind-icloud`. Apple account/container resolution and coordinated file operations are isolated there. Android/web never load the Apple module and explain that iCloud requires iOS. Expo Go has no bridge; rebuild a native client. Settings reports sign-out, unavailable container and native-build setup separately. Sign-in and disabling iCloud are managed in iPhone Settings; the app does not sign the user out of their device-wide Apple Account.

Select iCloud Drive explicitly for future originals. Files are copied into the user's app container at `Documents/Receipts/<uuid>.<extension>`, visible under ReceiptMind in Files/iCloud Drive. Names contain no merchant or input filename. Saving means the coordinated local iCloud document write succeeded; Apple's asynchronous upload may still be pending (offline, quota or service failure). It is not confirmation of remote backup. Availability checks account/container access and, for an original, ubiquitous file metadata; an evicted file can be available for download even when offline opening fails. Opening requests download, waits up to 30 seconds for downloaded content, copies a coordinated snapshot to app cache and presents the iOS open/share sheet. Retry after connectivity returns. Temporary previews are removed after the sheet and at successful next startup following an interruption.

References use `icloud://<container>/<account-token-sha256>/<uuid>.<extension>`, never an absolute sandbox path or credential. The native bridge checks the current account on every operation, validates reference grammar/container and rejects traversal and symlinks. Account identity is a hash of Apple's archived opaque ubiquity identity token, not an email or authorization token. References remain unchanged across provider switches and sandbox relocation; they are purchase provenance, not a portable history-sync/restore mechanism. A different account, missing/moved/renamed file, download error or denied access leaves encrypted purchase history intact and editable. Return to the original account/path to restore access. Account-token changes can require re-linking outside this implementation; no account migration is provided.

The existing pending-original journal records the reserved reference before copying. Failed copies or encrypted writes roll back only that unique original. If the account/container is unavailable during rollback, cleanup remains pending across restarts and Settings offers Retry original cleanup. History remains readable/exportable. History/device deletion keeps iCloud originals; delete those separately in Files. Structured purchase data continues through the same privacy sanitizer and AES-GCM/SecureStore persistence. No structured history is uploaded to iCloud by this provider.

#### Apple Developer and signing setup (required)

1. In Apple Developer Certificates, Identifiers & Profiles, use the explicit App ID `com.shameem.receiptmind` under your paid developer team. Enable iCloud with iCloud Documents and register/assign `iCloud.com.shameem.receiptmind` to that App ID. This public identifier is not a secret. If changing the bundle ID, update the `NSUbiquitousContainers` key in `app.json` too; the bridge and document-picker plugin derive the container as `iCloud.<bundleIdentifier>`. Existing references continue to require their original container, so changing it is not a storage migration.
2. `ios.usesIcloudStorage` and the `expo-document-picker` config plugin generate `com.apple.developer.icloud-container-identifiers` and `com.apple.developer.ubiquity-container-identifiers` with that container, `com.apple.developer.icloud-services = [CloudDocuments]`, and `com.apple.developer.ubiquity-kvstore-identifier = $(TeamIdentifierPrefix)com.shameem.receiptmind`. The provider uses documents, not CloudKit or the key-value store. The plugin also emits the iCloud container environment. See [Expo document-picker configuration](https://docs.expo.dev/versions/latest/sdk/document-picker/).
3. `ICLOUD_CONTAINER_ENVIRONMENT` is a non-secret build setting: defaults to `Production` for distribution; set `Development` when using a development profile that requires it. Match the entitlement to the actual provisioning profile. In Xcode select the correct Team, enable iCloud Documents and select the same container in Signing & Capabilities. Refresh/regenerate profiles after changing capabilities, including registered physical device UDIDs for development/Ad Hoc. EAS capability synchronization does not replace checking the container association and signed profile. App transfers may require the original team prefix via the document-picker plugin's `kvStoreIdentifier` option. See [Expo iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/).
4. `NSUbiquitousContainers` declares ReceiptMind's document scope visible in the user's iCloud Drive with supported folder levels. ?Public? document scope means visible to the user in Files, not anonymous internet sharing. See [Apple iCloud document configuration](https://developer.apple.com/library/archive/documentation/General/Conceptual/iCloudDesignGuide/Chapters/DesigningForDocumentsIniCloud.html). Increment the iOS build number if changing container display metadata on an already-installed build.
5. Run `npm install`, `npx expo prebuild --platform ios` and `npx expo run:ios --device` on macOS/Xcode, or produce an appropriately signed EAS build. The local Expo module autolinks; confirm the ReceiptMindICloud pod is installed. Inspect the generated entitlements and the final signed app with `codesign -d --entitlements :- <app-path>`, and compare to the embedded provisioning profile. Native code and entitlement changes require a new binary, not an OTA update. See [Expo local native modules](https://docs.expo.dev/modules/get-started/).
6. Keep Apple passwords, signing certificate private keys, App Store Connect keys and provisioning credentials in Xcode/EAS secure credential storage, never Git or `EXPO_PUBLIC_*`. No Apple private credentials are needed in JavaScript or the backend. Existing ignore rules exclude `.p8`, `.p12` and `.mobileprovision` files.

#### Validation limits and physical-device checklist

Automated tests mock the native iCloud boundary and exercise provider availability, prepare/save/open/delete errors, preview cleanup, Android exclusion, provider switching, encrypted-write rollback and restart recovery. Expo config introspection and Apple autolinking can run on Windows; they do not compile Swift or exercise iCloud. **No signed physical iPhone build was available for this change; real iCloud operation has not been tested.**

Before release, compile/sign and install on a physical iPhone. Test PDF/image save and open; verify the original appears in Files and completes upload on another device using the same account; restart/update the app and reopen saved references; evict/download a file; delete, rename or move it; test offline reads, cloud/device quota, iCloud Drive disabled, sign-out and switching Apple Accounts; reconnect the original account; force an encrypted-write failure and interrupted cleanup; switch all three providers and confirm old references/history remain intact. Confirm temporary preview cleanup and test both development and distribution signing configurations. A simulator, mocked test or successful Metro bundle is not real iCloud validation.

## Privacy model

- No database columns for card numbers, IBANs, BICs, bank accounts, terminal IDs, authorization codes or payment references.
- Sensitive-looking payment lines are rejected by both the extraction backend and client sanitizer.
- Original receipts are not stored by the ReceiptMind backend.
- No AI secret is shipped in the mobile binary or committed to GitHub.
- Receipt extraction requires Google sign-in in a native build. Limits and metering run in Cloudflare. The Worker retains no receipt content; Google may retain prompts for abuse monitoring. Review the Worker deployment document before release.
- If structured records later move to a backend, use per-user row-level access, encryption, and GDPR-compliant retention/deletion policies.

## Production next steps

1. Complete Google Console registration and validate the implemented Drive provider on signed Android/iOS builds.
2. Configure Apple iCloud container/signing and validate the implemented provider on a signed physical iPhone.
3. Configure and manually deploy the secured Worker after reviewing OAuth, limits, provider retention and pricing in its deployment guide. Scans default to disabled.
4. For larger datasets, migrate the encrypted blob store to SQLCipher/local SQLite while preserving the same encryption/privacy model.
5. If adding backend history sync, add per-user RLS. Paid subscription entitlement management remains separate from the configured scan allowance.
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
