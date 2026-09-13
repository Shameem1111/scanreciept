---
name: receiptmind
description: Implement and maintain the ReceiptMind privacy-first Expo/React Native receipt-memory app while preserving its storage, AI, encryption, and payment-data privacy invariants.
---

# ReceiptMind project skill

Use this skill for any task in `Shameem1111/scanreciept` involving receipt scanning, extraction, categorization, storage, search, chat, privacy, encryption, subscriptions, or mobile UX.

## Start every task here

1. Read `AGENTS.md`.
2. Read `README.md`.
3. Inspect only the files relevant to the requested change.
4. Preserve existing privacy and storage abstractions unless the task explicitly requires an architectural change.
5. Prefer a small, focused change over a broad redesign.

## Product model

ReceiptMind is a **private purchase-memory app**, not merely an expense tracker.

The product should let a user:

- scan or upload a receipt
- extract purchased line items automatically
- categorize each line item
- preserve the original receipt in user-selected storage
- search purchases later
- ask natural-language questions about purchase history
- verify answers against the original receipt when available

A feature is valuable when it improves one of these questions:

- What did I buy?
- When did I buy it?
- Where did I buy it?
- What did it cost?
- How has its price changed?
- Where is the original proof/receipt?

## Non-negotiable privacy rule

ReceiptMind must never create searchable structured data for payment/banking credentials.

Never extract or persist:

- card numbers, even masked numbers
- CVV or expiry
- IBAN
- BIC/SWIFT
- bank-account numbers
- authorization codes
- payment references
- terminal IDs
- banking credentials

If this content appears in OCR or AI output, redact/drop it before it enters app state or persistence.

Do not expand the schema to include payment-method metadata unless the user explicitly revises this privacy requirement.

## Receipt ingestion workflow

Preferred flow:

```text
Camera / File upload
        ↓
Temporary receipt input
        ↓
Privacy-aware extraction backend
        ↓
Validate + sanitize result
        ↓
User review when confidence is low
        ↓
Store original via selected StorageProvider
        ↓
Encrypt and persist structured purchase record
```

### Scan versus upload

Keep these distinct in the UX:

- **Scan Receipt** -> device camera
- **Upload Receipt** -> gallery/file/PDF

Do not hide both behind a vague generic upload button.

## Receipt extraction schema

The accepted structured result should stay close to:

```ts
interface ReceiptExtraction {
  merchant: string;
  purchaseDate: string;
  total: number;
  currency: string;
  source: 'ai' | 'demo' | 'manual';
  items: Array<{
    id: string;
    originalText: string;
    name: string;
    category: string;
    quantity: number;
    price: number;
    unitPrice?: number;
    confidence?: number;
  }>;
}
```

Keep `originalText` and normalized `name` separately.

Never invent missing item data with high confidence. If a field cannot be reliably extracted, mark uncertainty and let the user correct it.

## Categorization behavior

Categorize at **item level**, not receipt level.

Example receipt:

```text
Bananas       -> Food
Paracetamol   -> Medicine
Trousers      -> Clothing
Detergent     -> Household
```

The category model should support user corrections and later alias-learning without destroying the original receipt text.

## Product normalization

Normalization is core to long-term purchase memory.

Examples:

```text
BIO BAN
BANANEN BIO
BIO BANANE 1KG
        ↓
Organic Bananas
```

```text
PERGOV 900 PEN
PERGOV.900IU
        ↓
Pergoveris 900 IU
```

Keep normalization reversible/auditable by preserving the source text.

## Storage-provider pattern

Original receipt storage is independent from structured purchase history.

Supported providers:

- local device
- Google Drive
- iCloud Drive

Use a provider abstraction. Screens should not contain provider-specific upload logic.

When adding a provider:

1. implement provider availability detection
2. implement save
3. implement open/read reference
4. provide clear user-facing setup errors
5. return a stable storage reference to attach to the receipt record
6. do not copy originals to ReceiptMind-owned cloud storage unless the user explicitly chose such a service

### Google Drive

Use narrow authorization such as `drive.file` where possible.

Avoid whole-Drive access.

### iCloud

Keep Apple capability/container handling isolated to the iCloud provider. Do not make the rest of the app depend on Apple-only APIs.

## Local encryption

Structured purchase history must remain encrypted.

Current model:

- AES-GCM ciphertext
- per-device encryption key
- key stored through `expo-secure-store`
- ciphertext stored separately

When modifying persistence:

- preserve encryption at rest
- never log plaintext purchase history
- never expose encryption keys in source or environment files
- ensure logout/account deletion handles local encrypted data appropriately

## AI integration pattern

Never embed an AI provider secret in the Expo app.

Mobile app -> secured ReceiptMind backend -> AI provider.

The backend should:

1. authenticate/rate-limit the request when production auth exists
2. accept the receipt temporarily
3. instruct the model to exclude payment/banking data
4. validate the returned JSON against the allowed schema
5. remove prohibited fields/text again server-side
6. return only the allowed structured receipt result
7. avoid retaining original receipt content beyond what is operationally required

The mobile app must sanitize the returned result again before persistence.

## Ask/search architecture

Use deterministic queries for deterministic questions.

Examples:

```text
"Show purchases from REWE"
"How much did I spend on Food in August?"
"When did I last buy Pergoveris?"
"Where did I buy bananas cheapest?"
```

Preferred architecture:

```text
User question
    ↓
Intent parser if needed
    ↓
Constrained query object
    ↓
Local/remote database query
    ↓
Deterministic aggregation
    ↓
Human-readable answer + receipt references
```

AI may interpret language. It should not perform authoritative financial arithmetic when code can do it reliably.

Do not execute arbitrary SQL produced by an LLM.

## Query intent contract

Prefer a limited internal query representation such as:

```ts
type PurchaseQuery = {
  intent: 'sum' | 'list' | 'find_receipt' | 'price_history' | 'cheapest';
  product?: string;
  merchant?: string;
  category?: string;
  fromDate?: string;
  toDate?: string;
};
```

Extend this intentionally when new question types are added.

## Proof-backed answers

Whenever a purchase answer is shown, include receipt provenance when practical.

Example:

```text
Pergoveris 900 IU — €483.20
3 Sep 2026 — ABC Apotheke
[View receipt]
```

If the original file has been deleted/disconnected, show:

```text
Original receipt unavailable
```

Do not delete the structured historical record merely because the file reference becomes unavailable.

## Privacy Center expectations

Privacy should be visible product behavior.

The app should make it understandable:

- where original receipts are stored
- whether AI processing was used
- that banking/card details are not extracted
- whether local structured data is encrypted
- how to export/delete data
- how to disconnect cloud providers

Avoid claims such as "zero possibility of data leak". Use accurate statements about controls and architecture.

## Cost-control rules

Protect the subscription model by using AI only when useful.

Prefer:

- no AI for basic search/filter/sum
- one extraction call when a receipt is first added
- no repeated historical reprocessing by default
- cached normalization/category results
- explicit usage metering when backend billing is implemented

When adding subscriptions, use explicit scan/query allowances rather than promising unlimited expensive operations.

## Mobile UX standard

This is a native mobile product.

For new screens/features:

- design for narrow phone widths first
- avoid desktop-like tables
- minimize typing
- make scan action prominent
- make touch targets comfortable
- keep review/correction workflows short
- clearly communicate privacy consequences of cloud actions

Core navigation:

```text
Home | Scan | Purchases | Ask | Settings
```

## Common implementation playbooks

### Add a receipt field

Before adding a field:

1. confirm it serves purchase memory
2. confirm it is not payment/banking/identity data
3. update `src/types.ts`
4. update extraction validation
5. update sanitization if needed
6. update persistence
7. update UI only where useful
8. keep backward compatibility with existing encrypted records where possible

### Add a new AI-derived feature

1. determine whether deterministic logic can replace AI
2. minimize context sent to AI
3. define a strict output schema
4. filter sensitive fields before/after the AI boundary
5. meter cost in production design
6. expose uncertainty when appropriate

### Add Google Drive/iCloud

1. implement inside the storage service/provider layer
2. request least privilege
3. never put provider secrets in client code
4. handle disconnected/expired credentials
5. preserve structured data if the original file becomes unavailable
6. test provider switching without losing historical references

### Add backend/Supabase sync

1. mobile keeps no service-role secret
2. use per-user auth
3. enable Row Level Security on user-data tables
4. deny cross-user reads/writes by default
5. keep originals outside ReceiptMind cloud unless explicitly opted in
6. implement delete/export flows
7. log operational metadata, not receipt contents or health-sensitive item names

## Validation checklist

Before considering a task done, check:

- [ ] TypeScript types remain coherent
- [ ] no API secrets were added to the client/repo
- [ ] no card/bank/payment fields were added
- [ ] privacy sanitizer still runs before persistence
- [ ] structured local data remains encrypted
- [ ] storage choice is respected
- [ ] low-confidence extraction does not silently fabricate data
- [ ] deterministic calculations remain deterministic
- [ ] original receipt provenance is preserved when relevant
- [ ] mobile UX remains usable on Android and iPhone
- [ ] README/AGENTS updated if architecture/setup changed

Run when possible:

```bash
npm install
npm run typecheck
npx expo start
```

If native credentials/capabilities prevent a full test, document the exact untested portion rather than claiming it works.

## Do not do these by default

- do not add bank connections
- do not parse card/account details
- do not add purchase-data advertising
- do not send the whole purchase database to an LLM for simple queries
- do not replace user-owned storage with company-owned storage silently
- do not weaken encryption for development convenience
- do not make unrelated visual redesigns during focused feature work
- do not claim Google Drive/iCloud integration is complete until real authentication/storage has been tested

## Success condition

A good ReceiptMind change makes purchase memory more useful while keeping the user's receipts, purchase history, and sensitive financial information under tighter—not weaker—control.
