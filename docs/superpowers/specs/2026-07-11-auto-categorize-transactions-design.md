# Auto-Categorize Transactions — Design

Date: 2026-07-11
Status: Approved (pending implementation plan)

## Problem

Transaction categorization is currently fully manual: a user opens the
transactions page and picks one of the seeded bookkeeping categories
(Subscriptions, Software, Meals, Travel, Transportation, Utilities, Rent,
Payroll, Transfer, Taxes, Uncategorized) from a dropdown, which sets
`Transaction.userCategoryId` + `categorizedAt`. Every transaction has to be
touched by hand.

We already store strong categorization signals at sync time
(`pfcPrimary`, `pfcDetailed`, `pfcConfidenceLevel` from Plaid's
`personal_finance_category`, plus a curated `Merchant` table and
recurring-stream membership) but do nothing with them.

## Goal

Automatically compute a **suggested** category for each transaction from
signals we already have, using a deterministic rule engine. Suggestions are
surfaced in the UI for one-click confirmation. Nothing is silently written as a
final decision — the manual `userCategoryId` is only ever set when the user
confirms, satisfying the CLAUDE.md rule to mark uncertain detections as
"needs review".

## Decisions (from brainstorming)

- **Engine:** Deterministic rules. No LLM, no external cost, predictable and
  testable. Matches the project's deterministic-insights ethos.
- **Write behavior:** Suggest only, never auto-fill. Suggestion is stored in
  new columns separate from `userCategoryId`. The manual field is untouched
  until the user confirms.
- **Trigger:** Compute at Plaid sync time for new/modified transactions, plus a
  one-time "Suggest categories" backfill button for existing rows.
- **Tests:** Add a lightweight `node:test` + `tsx` harness (`test` npm script)
  and a checked-in unit-test file for the pure rule engine.

## Non-Goals (YAGNI)

- No LLM / AI classification.
- No auto-writing of `userCategoryId` (no "auto-confirm").
- No per-user learned rules or user-editable rule tables in this iteration.
- No new confirm endpoint — confirmation reuses the existing categorize route.

## Architecture

### 1. Rule engine — `src/lib/category-suggestion.ts` (pure)

Exports a pure function with no DB or I/O so it is unit-testable in isolation:

```ts
export interface SuggestionInput {
  merchantName: string | null;
  name: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pfcConfidenceLevel: string | null;
  recurringStreamId: string | null;
}

export interface CategorySuggestion {
  categoryName: string;        // resolved to an id by the caller
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: "MERCHANT" | "RECURRING" | "PFC";
}

export function suggestCategory(input: SuggestionInput): CategorySuggestion | null;
```

Returns `null` when no rule matches confidently (the transaction stays
Uncategorized / needs review).

**Rule precedence — first match wins:**

| # | Signal | Result category | Confidence | source |
|---|--------|-----------------|-----------|--------|
| 1 | Curated merchant match (e.g. Adobe→Software; Netflix, Spotify, Amazon Prime, Apple, Google→Subscriptions) | mapped | HIGH | MERCHANT |
| 2 | `recurringStreamId` is set (member of a recurring stream) | Subscriptions | HIGH | RECURRING |
| 3 | Plaid `pfcDetailed` then `pfcPrimary` via mapping table | mapped | derived from `pfcConfidenceLevel` | PFC |
| — | no match | `null` | — | — |

The curated merchant list (rule 1) reuses the merchant names already seeded in
`prisma/seed.ts`. Matching is case-insensitive against `merchantName` (falling
back to `name`).

**Confidence derivation for PFC rule:**
`VERY_HIGH`/`HIGH` → HIGH, `MEDIUM` → MEDIUM, `LOW`/`UNKNOWN`/null → LOW.

**PFC → category mapping table** (keyed by `pfcDetailed` where meaningful,
else `pfcPrimary`):

- `FOOD_AND_DRINK*` → Meals
- `TRANSPORTATION*` → Transportation
- `TRAVEL*` → Travel
- `RENT_AND_UTILITIES_RENT*` → Rent
- other `RENT_AND_UTILITIES*` → Utilities
- `INCOME*` → Payroll
- `TRANSFER_IN*`, `TRANSFER_OUT*`, `LOAN_PAYMENTS*` → Transfer
- `GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT` → Taxes
- Ambiguous primaries (`GENERAL_MERCHANDISE`, `HOME_IMPROVEMENT`, `MEDICAL`,
  `PERSONAL_CARE`, `BANK_FEES`, `GENERAL_SERVICES` unless a software-like
  detailed) → `null` (no guess).

The exact/full mapping lives in code as a constant; the list above is
representative. Category names must match the seeded `TransactionCategory.name`
values exactly.

### 2. Data model — Prisma migration

Add suggestion columns to `Transaction`, fully separate from `userCategoryId`
so re-syncs never overwrite a user's confirmed decision:

- `suggestedCategoryId String?` — FK → `TransactionCategory`, `onDelete: SetNull`
- `suggestedCategoryName String?`
- `suggestedConfidence String?` — `HIGH | MEDIUM | LOW`
- `suggestedSource String?` — `MERCHANT | RECURRING | PFC`
- `suggestedAt DateTime?`

Add the inverse relation on `TransactionCategory` and an index on
`[userId, suggestedCategoryId]`. Generate a migration.

### 3. Persistence layer — `src/lib/category-suggestion.ts` companion or `apply` helper

A small server-side helper resolves the engine's `categoryName` to a
`TransactionCategory.id` (categories have unique names) and writes the
`suggested*` fields. Suggestions are only *surfaced* for transactions where
`userCategoryId == null`; the helper may still compute/store for all rows, but
the UI gates on `userCategoryId`.

### 4. Where it runs

- **Sync time:** `src/lib/plaid-sync.ts#upsertTransaction` computes and writes
  the suggestion for each added/modified transaction (merchant + PFC rules are
  available at sync; the recurring rule may not be, since recurring detection
  runs separately).
- **Backfill:** new route `POST /api/transactions/suggest-categories`
  (same-origin via `requireSameOrigin`, user-scoped via `getCurrentUser`) that
  recomputes suggestions for the user's transactions that are uncategorized and
  lack a suggestion. Running it after recurring detection also applies the
  recurring-stream rule. Returns `{ updated }` counts. Every Prisma query
  filters by the authenticated `userId`.

### 5. UI

- `src/components/transaction-category-select.tsx` gains a `suggestion` prop
  `{ id, name, confidence } | null`. When the transaction is uncategorized and
  a suggestion exists, render `Suggested: <name>` with a **Confirm** button.
  `LOW` confidence renders with a "needs review" badge.
- **Confirm** reuses the existing `POST /api/transactions/[id]/categorize`
  route with `categoryId = suggestion.id`, which already sets `userCategoryId`
  + `categorizedAt`. No new endpoint.
- The transactions page (`src/app/(app)/transactions/page.tsx`) selects the new
  `suggested*` fields and passes them into the select. Add a **"Suggest
  categories"** client button mirroring the existing
  `src/components/detect-subscriptions-button.tsx` pattern (POST → on success
  `router.refresh()`).

## Data Flow

```
Plaid sync ──> upsertTransaction ──> suggestCategory(input)
                                        │
                                        └─> resolve name→id, write suggested* fields
Transactions page ──> reads suggested* (only shown when userCategoryId == null)
User clicks Confirm ──> POST /transactions/[id]/categorize { categoryId: suggestedId }
                          └─> sets userCategoryId + categorizedAt (existing route)
Backfill button ──> POST /transactions/suggest-categories
                      └─> recompute suggestions for uncategorized rows (incl. recurring rule)
```

## Error Handling

- Engine returns `null` on no confident match → no suggestion shown.
- If `suggestedCategoryId` points at a deleted category, `onDelete: SetNull`
  clears it; UI treats a null id as no suggestion.
- Backfill route returns typed JSON errors via existing `safeLogError` /
  `clientErrorMessage` helpers, like the other routes. Never logs Plaid
  tokens/configs.
- Suggestion computation failures at sync time must not abort the sync — a
  suggestion is best-effort; wrap so a failure leaves `suggested*` null.

## Testing

- Add `"test": "tsx --test"` (or `node --import tsx --test`) to `package.json`.
- `src/lib/category-suggestion.test.ts` with `node:test` covering:
  - curated merchant hit → HIGH / MERCHANT
  - recurring-stream member → Subscriptions / HIGH / RECURRING
  - each PFC bucket (Meals, Transportation, Travel, Rent vs Utilities split,
    Payroll, Transfer, Taxes)
  - confidence downgrade from `pfcConfidenceLevel`
  - ambiguous primary → `null`
  - precedence: merchant beats recurring beats PFC
- Verify with `npm test`, `npx tsc --noEmit` (typecheck), and `npm run build`.

## Open Questions

None. Ready for implementation planning.
