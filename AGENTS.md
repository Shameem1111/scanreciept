# AGENTS.md — ReceiptMind / scanreciept

This file contains mandatory instructions for any coding agent working in this repository.

## 1. Product mission

ReceiptMind is a privacy-first Android/iOS purchase-memory app.

The core user flow is:

1. Scan a paper receipt with the camera, or upload an existing receipt image/PDF.
2. Extract merchant, date, total, currency, and individual purchased items.
3. Categorize each item separately.
4. Store the original receipt in the user's selected storage location.
5. Store structured purchase history securely.
6. Let the user search and ask natural-language questions about past purchases.
7. Every answer should be traceable back to the original receipt when available.

ReceiptMind is **not primarily a budgeting app**. Its product promise is:

> A private, searchable memory of everything the user has bought.

## 2. Read before changing code

Before implementing a task, read:

- `AGENTS.md`
- `README.md`
- `.codex/skills/receiptmind/SKILL.md`
- the files directly related to the requested change

Do not redesign unrelated areas when implementing a focused task.

## 3. Current stack

- Expo SDK 57
- React Native 0.86.3
- TypeScript 6.0 (Expo-aligned)
- `expo-image-picker` — camera/gallery receipt input
- `expo-document-picker` — file/PDF receipt input
- `expo-file-system` — local original receipt storage
- `expo-crypto` — AES-GCM encryption
- `expo-secure-store` — encryption key storage
- AsyncStorage stores encrypted purchase history plus non-content settings and pending-operation markers/references; never OAuth tokens

Primary source folders:

- `src/screens/` — application screens
- `src/services/` — AI, privacy, encryption, storage integrations
- `src/store/` — app state and purchase history
- `src/components/` — shared UI
- `src/types.ts` — shared domain types

## 4. Hard privacy invariants

These rules are non-negotiable.

### 4.1 Never extract or persist banking/payment credentials

ReceiptMind must not extract, store, classify, index, return, log, or expose:

- full or masked payment-card numbers
- card expiry or CVV
- IBAN
- BIC/SWIFT
- bank-account numbers
- banking credentials
- authorization codes
- payment reference numbers
- terminal IDs
- merchant terminal/payment-processor identifiers
- online banking information

Do not add database/model fields for these values.

If OCR or AI returns them, discard/redact them before they enter application state.

The untouched original receipt may contain payment information because it belongs to the user and is stored in the user's selected original-receipt storage. That information must not become structured searchable ReceiptMind data.

### 4.2 Data minimization

Extract only what is required for purchase memory:

- merchant
- purchase date/time when useful
- currency
- total/tax/discount information when useful
- item description
- normalized/canonical item name
- quantity
- item price
- unit price when derivable
- category/subcategory
- extraction confidence
- reference to original receipt

Do not collect identity or financial information merely because it appears on a receipt.

### 4.3 No secrets in the mobile app

Never commit or ship:

- OpenAI/Gemini/API secret keys
- Supabase service-role keys
- Google OAuth client secrets
- private encryption master keys
- Apple private credentials

The mobile app may contain public client identifiers only when the provider explicitly permits that usage.

AI extraction must go through a secured backend endpoint. `EXPO_PUBLIC_*` values are public and must never contain secrets.

### 4.4 User-controlled original receipt storage

Supported storage model:

- Local device
- Google Drive
- iCloud Drive

Local and Google Drive providers are implemented. Google Drive requires public mobile OAuth configuration and a native build. Google Drive and iCloud providers must remain behind the storage-provider abstraction.

Do not silently upload original receipt files to ReceiptMind-owned cloud storage.

If cloud storage is added later, it must be an explicit user choice.

### 4.5 Encryption

Structured local purchase history must remain encrypted at rest.

- Data encryption: AES-GCM
- Encryption key: device secure storage
- Never store the encryption key beside the ciphertext
- Never log decrypted purchase history

If the persistence layer is migrated (for example to SQLite/SQLCipher), preserve or improve the current privacy properties.

## 5. AI rules

AI should assist with extraction, normalization, categorization, and natural-language intent understanding.

AI must not be the source of truth for arithmetic or database aggregation when deterministic code can do the job.

Example:

User asks: `How much did I spend on medicine in August?`

Preferred flow:

1. Convert the natural-language request into a constrained query intent.
2. Query/filter structured purchase records.
3. Calculate the total deterministically.
4. Return supporting purchases/receipts.

Do not send a user's entire purchase history to an LLM just to calculate a sum.

### AI extraction contract

The receipt extraction backend should return only the defined receipt schema. Banking/payment fields are prohibited.

All AI results are untrusted input. Validate/sanitize them on the backend and again on the mobile client before persistence.

If extraction confidence is low, prefer asking the user to confirm/correct the item rather than silently inventing data.

## 6. Storage-provider architecture

All original receipt storage should be accessed through a provider abstraction.

Conceptually:

```ts
interface ReceiptStorageProvider {
  saveReceipt(input: SaveReceiptInput): Promise<StoredReceiptReference>;
  openReceipt(reference: StoredReceiptReference): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

Providers:

- `local`
- `google-drive`
- `icloud-drive`

Do not place provider-specific logic throughout screens.

For Google Drive, prefer the narrow `drive.file` permission. Do not request whole-Drive read access unless a future feature absolutely requires it and the privacy implications have been explicitly accepted.

## 7. Search and chat rules

Search must work without AI whenever possible.

Examples that should normally be deterministic/local:

- search by product name
- filter by merchant
- filter by category
- filter by date range
- monthly/category totals
- product price history
- cheapest prior purchase

Natural-language chat should translate the user's question into a constrained internal intent such as:

```ts
{
  intent: 'sum' | 'list' | 'find_receipt' | 'price_history' | 'cheapest',
  product?: string,
  merchant?: string,
  category?: string,
  fromDate?: string,
  toDate?: string
}
```

Do not allow an LLM to generate arbitrary SQL that is executed directly.

## 8. Product behavior

### Scan / upload

Receipt extraction must support German, English, and mixed-language receipts. Preserve printed item text (including umlauts and ß); interpret German decimal commas and local date formats correctly. Keep category identifiers consistent with the existing schema.

The primary actions must remain clearly separated:

- **Scan Receipt** — camera
- **Upload Receipt** — gallery/file/PDF

After extraction, show a review step before save when data is uncertain.

### Item-level categorization

Do not classify only the whole receipt.

A single receipt may contain:

- food
- medicine
- clothing
- household products

Each line item must be categorized independently.

### Purchase normalization

Keep both:

- original receipt text
- normalized product name

Example:

`PERGOV 900 PEN` -> `Pergoveris 900 IU`

Do not overwrite the original source text.

### Proof-backed answers

Whenever possible, answers about a purchase should link to the corresponding receipt reference.

If the original receipt file is no longer accessible, preserve the structured purchase record and display that the original receipt is unavailable.

## 9. UI principles

ReceiptMind is a mobile-first application. Do not design desktop/web-first layouts.

Prioritize:

- one-hand usage
- large scan action
- minimal typing
- fast confirmation
- accessible text/touch targets
- simple, calm privacy messaging

Core navigation should remain focused around:

- Home
- Scan
- Purchases
- Ask
- Settings/Privacy

Do not add major navigation sections unless the feature clearly justifies it.

## 10. Cost discipline

The business model depends on low per-user infrastructure cost.

Prefer:

- deterministic local queries over AI calls
- one AI extraction per new receipt rather than repeated reprocessing
- cached normalized results
- user-owned original receipt storage
- small/low-cost models where quality is sufficient

Do not add background AI jobs that repeatedly reprocess all historical receipts without a strong product reason.

Track AI usage/cost when a production backend is added.

## 11. Scope discipline

Current priority is a reliable receipt-memory MVP.

Do not add these unless explicitly requested:

- bank-account connections
- payment initiation
- tax filing
- financial advice
- credit scoring
- ads based on purchase history
- automatic email scraping
- large social/community features

## 12. Coding rules

- TypeScript only for application code.
- Reuse existing services/store abstractions before creating new parallel systems.
- Keep components small and focused.
- Keep privacy filtering centralized in `src/services/privacy.ts` or a clearly superior replacement.
- Do not bypass encrypted persistence.
- Do not hardcode secrets.
- Do not swallow important errors silently.
- Keep platform-specific code isolated where practical.

## 13. Validation before finishing a task

Run, when dependencies/environment permit:

```bash
npm install
npm run typecheck
npx expo start
```

For native changes, also test the affected platform when available.

For privacy-sensitive changes, explicitly verify:

1. No payment/banking fields were added.
2. Sensitive OCR/AI text is filtered before persistence.
3. No secrets are committed.
4. Original receipt storage still follows the user's chosen provider.
5. Structured records remain encrypted locally.

If a check cannot be run, state that clearly in the final task summary.

## 14. Definition of done

A change is complete when:

- the requested behavior works or is implemented as far as the environment allows
- unrelated behavior is preserved
- privacy invariants remain intact
- TypeScript types are updated
- new provider/API behavior has error handling
- user-facing failure states are understandable
- documentation is updated when architecture/setup changes

Privacy and data ownership take priority over convenience.
