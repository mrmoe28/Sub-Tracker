# Auto-Categorize Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically compute a suggested bookkeeping category for each transaction from signals we already store, surfaced in the UI for one-click confirmation, without ever auto-writing the user's manual category.

**Architecture:** A pure deterministic rule engine (`suggestCategory`) maps curated merchants, recurring-stream membership, and Plaid `personal_finance_category` to our seeded categories. A server helper resolves the category name to an id and writes new `suggested*` columns — at Plaid sync time and via an on-demand backfill route. The transactions UI shows the suggestion with a Confirm button that reuses the existing categorize endpoint.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, `node:test` + `tsx` for the unit tests.

---

## File Structure

- **Create** `src/lib/category-suggestion.ts` — pure rule engine. No DB, no I/O. Exports `SuggestionInput`, `CategorySuggestion`, `suggestCategory()`.
- **Create** `src/lib/category-suggestion.test.ts` — `node:test` unit tests for the engine.
- **Create** `src/lib/apply-category-suggestion.ts` — server-only. Resolves category name→id, computes the DB field object, writes it at sync time and for backfill. Exports `loadCategoryIdByName()`, `computeSuggestedFields()`, `applySuggestionsForUser()`.
- **Create** `src/app/api/transactions/suggest-categories/route.ts` — backfill endpoint.
- **Create** `src/components/suggest-categories-button.tsx` — client button (mirrors `detect-subscriptions-button.tsx`).
- **Modify** `prisma/schema.prisma` — add `suggested*` columns + relation + index on `Transaction`.
- **Modify** `src/lib/plaid-sync.ts` — compute + write suggestion during sync.
- **Modify** `src/components/transaction-category-select.tsx` — render suggestion + Confirm.
- **Modify** `src/app/(app)/transactions/page.tsx` — select new fields, pass suggestion prop, add button.
- **Modify** `package.json` — add `test` script.

---

## Task 1: Pure rule engine + tests

**Files:**
- Create: `src/lib/category-suggestion.ts`
- Test: `src/lib/category-suggestion.test.ts`
- Modify: `package.json` (add `test` script)

> **Note on curated merchants:** The spec listed Netflix, Spotify, Adobe, Amazon Prime, Apple, Google. Bare "Apple"/"Google" match too broadly (an Apple hardware purchase or a Google Cloud bill are not subscriptions), so this task limits HIGH-confidence merchant rules to unambiguous patterns: `netflix`, `spotify`, `adobe`, and the specific phrase `amazon prime`. Apple/Google charges still get suggestions via the recurring-stream and PFC rules. This is a deliberate, documented refinement of the spec.

- [ ] **Step 1: Add the test script to `package.json`**

In the `"scripts"` block, add a `test` entry (place it after `"lint": "eslint",`):

```json
    "test": "node --import tsx --test src/lib/category-suggestion.test.ts",
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/category-suggestion.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { suggestCategory } from "./category-suggestion";

function base() {
  return {
    merchantName: null as string | null,
    name: "",
    pfcPrimary: null as string | null,
    pfcDetailed: null as string | null,
    pfcConfidenceLevel: null as string | null,
    recurringStreamId: null as string | null,
  };
}

test("curated merchant match wins with HIGH confidence", () => {
  const r = suggestCategory({ ...base(), merchantName: "Netflix" });
  assert.deepEqual(r, {
    categoryName: "Subscriptions",
    confidence: "HIGH",
    source: "MERCHANT",
  });
});

test("adobe maps to Software", () => {
  const r = suggestCategory({ ...base(), merchantName: "Adobe" });
  assert.equal(r?.categoryName, "Software");
  assert.equal(r?.source, "MERCHANT");
});

test("recurring-stream membership maps to Subscriptions", () => {
  const r = suggestCategory({ ...base(), recurringStreamId: "stream_1" });
  assert.deepEqual(r, {
    categoryName: "Subscriptions",
    confidence: "HIGH",
    source: "RECURRING",
  });
});

test("merchant beats recurring beats pfc", () => {
  const r = suggestCategory({
    ...base(),
    merchantName: "Spotify",
    recurringStreamId: "stream_1",
    pfcPrimary: "FOOD_AND_DRINK",
  });
  assert.equal(r?.source, "MERCHANT");
});

test("pfc FOOD_AND_DRINK maps to Meals", () => {
  const r = suggestCategory({
    ...base(),
    pfcPrimary: "FOOD_AND_DRINK",
    pfcConfidenceLevel: "HIGH",
  });
  assert.deepEqual(r, {
    categoryName: "Meals",
    confidence: "HIGH",
    source: "PFC",
  });
});

test("rent detailed splits from utilities primary", () => {
  const rent = suggestCategory({
    ...base(),
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_RENT",
    pfcConfidenceLevel: "VERY_HIGH",
  });
  assert.equal(rent?.categoryName, "Rent");

  const utils = suggestCategory({
    ...base(),
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
    pfcConfidenceLevel: "HIGH",
  });
  assert.equal(utils?.categoryName, "Utilities");
});

test("tax detailed maps to Taxes", () => {
  const r = suggestCategory({
    ...base(),
    pfcPrimary: "GOVERNMENT_AND_NON_PROFIT",
    pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
    pfcConfidenceLevel: "HIGH",
  });
  assert.equal(r?.categoryName, "Taxes");
});

test("income maps to Payroll and transfers map to Transfer", () => {
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "INCOME" })?.categoryName,
    "Payroll",
  );
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "TRANSFER_OUT" })?.categoryName,
    "Transfer",
  );
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "LOAN_PAYMENTS" })?.categoryName,
    "Transfer",
  );
});

test("confidence downgrades from pfcConfidenceLevel", () => {
  assert.equal(
    suggestCategory({
      ...base(),
      pfcPrimary: "TRANSPORTATION",
      pfcConfidenceLevel: "MEDIUM",
    })?.confidence,
    "MEDIUM",
  );
  assert.equal(
    suggestCategory({
      ...base(),
      pfcPrimary: "TRANSPORTATION",
      pfcConfidenceLevel: "LOW",
    })?.confidence,
    "LOW",
  );
  assert.equal(
    suggestCategory({
      ...base(),
      pfcPrimary: "TRANSPORTATION",
      pfcConfidenceLevel: null,
    })?.confidence,
    "LOW",
  );
});

test("ambiguous primary returns null", () => {
  assert.equal(
    suggestCategory({ ...base(), pfcPrimary: "GENERAL_MERCHANDISE" }),
    null,
  );
  assert.equal(suggestCategory(base()), null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `./category-suggestion` (engine not created yet).

- [ ] **Step 4: Write the rule engine**

Create `src/lib/category-suggestion.ts`:

```ts
export interface SuggestionInput {
  merchantName: string | null;
  name: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  pfcConfidenceLevel: string | null;
  recurringStreamId: string | null;
}

export type SuggestionConfidence = "HIGH" | "MEDIUM" | "LOW";
export type SuggestionSource = "MERCHANT" | "RECURRING" | "PFC";

export interface CategorySuggestion {
  // Category name; the caller resolves this to a TransactionCategory id.
  categoryName: string;
  confidence: SuggestionConfidence;
  source: SuggestionSource;
}

// Unambiguous curated merchants only. Bare "apple"/"google" are intentionally
// excluded because they over-match non-subscription charges; those still get
// suggestions from the recurring-stream and PFC rules below.
const CURATED_MERCHANTS: { pattern: RegExp; category: string }[] = [
  { pattern: /\bnetflix\b/i, category: "Subscriptions" },
  { pattern: /\bspotify\b/i, category: "Subscriptions" },
  { pattern: /\bamazon\s+prime\b/i, category: "Subscriptions" },
  { pattern: /\badobe\b/i, category: "Software" },
];

function pfcConfidence(level: string | null): SuggestionConfidence {
  switch (level) {
    case "VERY_HIGH":
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "LOW"; // LOW, UNKNOWN, null
  }
}

// Keyed by exact pfcDetailed where it changes the answer, else pfcPrimary.
function mapPfcToCategory(
  pfcPrimary: string | null,
  pfcDetailed: string | null,
): string | null {
  if (pfcDetailed === "RENT_AND_UTILITIES_RENT") return "Rent";
  if (pfcDetailed === "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT") return "Taxes";

  switch (pfcPrimary) {
    case "FOOD_AND_DRINK":
      return "Meals";
    case "TRANSPORTATION":
      return "Transportation";
    case "TRAVEL":
      return "Travel";
    case "RENT_AND_UTILITIES":
      return "Utilities";
    case "INCOME":
      return "Payroll";
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
    case "LOAN_PAYMENTS":
      return "Transfer";
    default:
      // GENERAL_MERCHANDISE, HOME_IMPROVEMENT, MEDICAL, PERSONAL_CARE,
      // BANK_FEES, GENERAL_SERVICES, ENTERTAINMENT, GOVERNMENT_AND_NON_PROFIT
      // (non-tax): no confident mapping.
      return null;
  }
}

export function suggestCategory(
  input: SuggestionInput,
): CategorySuggestion | null {
  const haystack = `${input.merchantName ?? ""} ${input.name ?? ""}`;

  for (const m of CURATED_MERCHANTS) {
    if (m.pattern.test(haystack)) {
      return { categoryName: m.category, confidence: "HIGH", source: "MERCHANT" };
    }
  }

  if (input.recurringStreamId) {
    return {
      categoryName: "Subscriptions",
      confidence: "HIGH",
      source: "RECURRING",
    };
  }

  const pfcCategory = mapPfcToCategory(input.pfcPrimary, input.pfcDetailed);
  if (pfcCategory) {
    return {
      categoryName: pfcCategory,
      confidence: pfcConfidence(input.pfcConfidenceLevel),
      source: "PFC",
    };
  }

  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green (11 tests, 0 failures).

- [ ] **Step 6: Commit**

```bash
git add src/lib/category-suggestion.ts src/lib/category-suggestion.test.ts package.json
git commit -m "feat(categorization): add deterministic category-suggestion rule engine"
```

---

## Task 2: Prisma schema — suggestion columns + migration

**Files:**
- Modify: `prisma/schema.prisma` (Transaction model ~lines 236-294, TransactionCategory model ~lines 296-313)

- [ ] **Step 1: Add suggestion fields to the `Transaction` model**

In `prisma/schema.prisma`, in the `model Transaction`, after the existing manual-classification block:

```prisma
  userCategoryName String?
  userCategoryNotes String? @db.Text
  categorizedAt DateTime?
```

add:

```prisma
  // Deterministic auto-categorization suggestion. Separate from the manual
  // userCategory* fields so re-syncs never overwrite a confirmed decision.
  // Surfaced in the UI only while userCategoryId is null.
  suggestedCategoryId   String?
  suggestedCategoryName String?
  suggestedConfidence   String?  // HIGH | MEDIUM | LOW
  suggestedSource       String?  // MERCHANT | RECURRING | PFC
  suggestedAt           DateTime?
```

- [ ] **Step 2: Add the relation and index to `Transaction`**

In the relations block of `Transaction` (where `userCategory TransactionCategory?` is declared), add after it:

```prisma
  suggestedCategory TransactionCategory? @relation("SuggestedCategory", fields: [suggestedCategoryId], references: [id], onDelete: SetNull)
```

The existing `userCategory` relation is unnamed; naming the new one avoids the ambiguous-relation error Prisma raises when two relations point at the same model. Update the existing `userCategory` line to a named relation so both are explicit:

Change:
```prisma
  userCategory TransactionCategory? @relation(fields: [userCategoryId], references: [id], onDelete: SetNull)
```
to:
```prisma
  userCategory TransactionCategory? @relation("UserCategory", fields: [userCategoryId], references: [id], onDelete: SetNull)
```

Then in the `@@index` block of `Transaction`, add:

```prisma
  @@index([userId, suggestedCategoryId])
```

- [ ] **Step 3: Update the inverse relation on `TransactionCategory`**

In `model TransactionCategory`, replace:

```prisma
  transactions Transaction[]
```

with the two named back-relations:

```prisma
  transactions          Transaction[] @relation("UserCategory")
  suggestedTransactions Transaction[] @relation("SuggestedCategory")
```

- [ ] **Step 4: Generate the migration**

Run: `npx prisma migrate dev --name add_transaction_category_suggestion`
Expected: creates `prisma/migrations/<timestamp>_add_transaction_category_suggestion/migration.sql`, applies it, and regenerates the Prisma client.

> If no local database is reachable (`DATABASE_URL` down), fall back to `npx prisma generate` to update the client types so the rest of the plan typechecks, and create the migration later with `migrate dev` against a live DB. Note this in the commit message if you take the fallback.

- [ ] **Step 5: Verify the client typechecks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors from the schema change; new fields are now on the `Transaction` type).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(categorization): add transaction suggestion columns"
```

---

## Task 3: Apply helper + sync-time integration

**Files:**
- Create: `src/lib/apply-category-suggestion.ts`
- Modify: `src/lib/plaid-sync.ts` (`upsertTransaction` ~lines 27-62, `syncPlaidItemTransactions` ~lines 64-140)

- [ ] **Step 1: Create the server-side apply helper**

Create `src/lib/apply-category-suggestion.ts`:

```ts
import "server-only";

import { prisma } from "./prisma";
import { suggestCategory, type SuggestionInput } from "./category-suggestion";

export interface SuggestedFields {
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  suggestedConfidence: string;
  suggestedSource: string;
  suggestedAt: Date;
}

// Default + this user's categories, keyed by unique name.
export async function loadCategoryIdByName(
  userId: string,
): Promise<Map<string, string>> {
  const cats = await prisma.transactionCategory.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    select: { id: true, name: true },
  });
  return new Map(cats.map((c) => [c.name, c.id]));
}

// Pure given the name→id map. Returns null when there is no confident
// suggestion or the mapped category name is not seeded.
export function computeSuggestedFields(
  input: SuggestionInput,
  categoryIdByName: Map<string, string>,
): SuggestedFields | null {
  const s = suggestCategory(input);
  if (!s) return null;
  const id = categoryIdByName.get(s.categoryName);
  if (!id) return null;
  return {
    suggestedCategoryId: id,
    suggestedCategoryName: s.categoryName,
    suggestedConfidence: s.confidence,
    suggestedSource: s.source,
    suggestedAt: new Date(),
  };
}

// Backfill: recompute suggestions for the user's uncategorized transactions.
// Picks up the recurring-stream rule for transactions linked after import.
export async function applySuggestionsForUser(
  userId: string,
): Promise<{ updated: number }> {
  const categoryIdByName = await loadCategoryIdByName(userId);
  const txns = await prisma.transaction.findMany({
    where: { userId, userCategoryId: null },
    select: {
      id: true,
      merchantName: true,
      name: true,
      pfcPrimary: true,
      pfcDetailed: true,
      pfcConfidenceLevel: true,
      recurringStreamId: true,
    },
  });

  let updated = 0;
  for (const t of txns) {
    const fields = computeSuggestedFields(
      {
        merchantName: t.merchantName,
        name: t.name,
        pfcPrimary: t.pfcPrimary,
        pfcDetailed: t.pfcDetailed,
        pfcConfidenceLevel: t.pfcConfidenceLevel,
        recurringStreamId: t.recurringStreamId,
      },
      categoryIdByName,
    );
    if (!fields) continue;
    await prisma.transaction.update({ where: { id: t.id }, data: fields });
    updated += 1;
  }
  return { updated };
}
```

> Scale note: this loops one `update` per uncategorized transaction. Fine for a personal tracker; if a user has tens of thousands of uncategorized rows this could be batched later.

- [ ] **Step 2: Wire suggestion computation into `upsertTransaction`**

In `src/lib/plaid-sync.ts`, add to the imports at the top (after the existing `./merchant` import):

```ts
import { computeSuggestedFields } from "./apply-category-suggestion";
```

Change the `upsertTransaction` signature to accept the category map:

```ts
async function upsertTransaction(
  userId: string,
  txn: PlaidTransaction,
  accountIdByPlaidId: Map<string, string>,
  categoryIdByName: Map<string, string>,
) {
```

Then, inside `upsertTransaction`, after the existing `const data = { ... };` object is built and before the `await prisma.transaction.upsert(...)` call, insert:

```ts
  // Best-effort suggestion. recurringStreamId is not known at sync time
  // (recurring detection runs separately); the backfill route fills that in.
  // A failure here must never abort the sync.
  let suggested: ReturnType<typeof computeSuggestedFields> = null;
  try {
    suggested = computeSuggestedFields(
      {
        merchantName: data.merchantName,
        name: data.name,
        pfcPrimary: data.pfcPrimary,
        pfcDetailed: data.pfcDetailed,
        pfcConfidenceLevel: data.pfcConfidenceLevel,
        recurringStreamId: null,
      },
      categoryIdByName,
    );
  } catch {
    suggested = null;
  }

  const suggestionData = suggested ?? {
    suggestedCategoryId: null,
    suggestedCategoryName: null,
    suggestedConfidence: null,
    suggestedSource: null,
    suggestedAt: null,
  };
```

Then merge `suggestionData` into the upsert. Change:

```ts
  await prisma.transaction.upsert({
    where: { plaidTransactionId: txn.transaction_id },
    update: data,
    create: { ...data, plaidTransactionId: txn.transaction_id },
  });
```

to:

```ts
  await prisma.transaction.upsert({
    where: { plaidTransactionId: txn.transaction_id },
    update: { ...data, ...suggestionData },
    create: { ...data, ...suggestionData, plaidTransactionId: txn.transaction_id },
  });
```

- [ ] **Step 3: Build the category map once per sync and pass it down**

In `syncPlaidItemTransactions`, after the imports are available and after `const plaid = getPlaidClient();` (before the `while (hasMore)` loop), add:

```ts
  const categoryIdByName = await loadCategoryIdByName(item.userId);
```

Add `loadCategoryIdByName` to the existing import from `./apply-category-suggestion`:

```ts
import {
  computeSuggestedFields,
  loadCategoryIdByName,
} from "./apply-category-suggestion";
```

Then update both `upsertTransaction` call sites inside the loop (in the `data.added` and `data.modified` loops) to pass the map:

```ts
    for (const txn of data.added) {
      await upsertTransaction(item.userId, txn, accountIdByPlaidId, categoryIdByName);
      added += 1;
    }
    for (const txn of data.modified) {
      await upsertTransaction(item.userId, txn, accountIdByPlaidId, categoryIdByName);
      modified += 1;
    }
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/apply-category-suggestion.ts src/lib/plaid-sync.ts
git commit -m "feat(categorization): compute suggestions at sync time + backfill helper"
```

---

## Task 4: Backfill API route

**Files:**
- Create: `src/app/api/transactions/suggest-categories/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/transactions/suggest-categories/route.ts` (mirrors `src/app/api/subscriptions/detect/route.ts`):

```ts
import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";
import { applySuggestionsForUser } from "@/lib/apply-category-suggestion";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const user = await getCurrentUser();
    const result = await applySuggestionsForUser(user.id);
    return NextResponse.json(result);
  } catch (err) {
    safeLogError("transactions/suggest-categories", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/transactions/suggest-categories/route.ts
git commit -m "feat(categorization): add suggest-categories backfill route"
```

---

## Task 5: Category select — suggestion + Confirm

**Files:**
- Modify: `src/components/transaction-category-select.tsx`

- [ ] **Step 1: Add the suggestion prop and Confirm UI**

Replace the entire contents of `src/components/transaction-category-select.tsx` with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface CategoryOption {
  id: string;
  name: string;
  group: string | null;
}

interface Suggestion {
  id: string;
  name: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

interface Props {
  transactionId: string;
  value: string | null;
  categories: CategoryOption[];
  suggestion?: Suggestion | null;
}

interface CategorizeResponse {
  error?: string;
}

export function TransactionCategorySelect({
  transactionId,
  value,
  categories,
  suggestion,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onChange(nextValue: string) {
    setSelected(nextValue);
    setError(null);

    const res = await fetch(`/api/transactions/${transactionId}/categorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: nextValue || null }),
    });
    const data = (await res.json()) as CategorizeResponse;
    if (!res.ok) {
      setError(data.error ?? "Failed");
      setSelected(value ?? "");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-1">
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs shadow-sm outline-none focus:border-ring"
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.group ? `${category.group}: ` : ""}
            {category.name}
          </option>
        ))}
      </select>
      {!selected && suggestion ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Suggested: {suggestion.name}
          </span>
          {suggestion.confidence === "LOW" ? (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-300">
              needs review
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onChange(suggestion.id)}
            disabled={pending}
            className="rounded-md border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/transaction-category-select.tsx
git commit -m "feat(categorization): show category suggestion with confirm action"
```

---

## Task 6: Transactions page wiring + Suggest button

**Files:**
- Create: `src/components/suggest-categories-button.tsx`
- Modify: `src/app/(app)/transactions/page.tsx`

- [ ] **Step 1: Create the Suggest Categories button**

Create `src/components/suggest-categories-button.tsx` (mirrors `detect-subscriptions-button.tsx`):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SuggestResponse {
  updated?: number;
  error?: string;
}

interface Props {
  disabled?: boolean;
}

export function SuggestCategoriesButton({ disabled }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/transactions/suggest-categories", {
        method: "POST",
      });
      const data = (await res.json()) as SuggestResponse;
      if (!res.ok) throw new Error(data.error ?? "Suggestion failed");
      setMessage(`Suggested categories for ${data.updated ?? 0} transactions.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={onClick} disabled={disabled || loading}>
        {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Suggest categories
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

> If `Button` does not accept a `variant="outline"` prop, drop the `variant` attribute — verify by opening `src/components/ui/button.tsx` before writing.

- [ ] **Step 2: Import the button and add the new select fields on the page**

In `src/app/(app)/transactions/page.tsx`, add the import near the other component imports (after the `SyncTransactionsButton` import on line 3):

```tsx
import { SuggestCategoriesButton } from "@/components/suggest-categories-button";
```

In the first `prisma.transaction.findMany` `select` block (the `transactions` query, ~lines 48-59), add the suggestion fields after `userCategoryName: true,`:

```tsx
        userCategoryName: true,
        suggestedCategoryId: true,
        suggestedCategoryName: true,
        suggestedConfidence: true,
```

- [ ] **Step 3: Render the button in the header**

In the header block, replace:

```tsx
        <SyncTransactionsButton disabled={!hasAnyItems} />
```

with:

```tsx
        <div className="flex flex-wrap items-start gap-2">
          <SuggestCategoriesButton disabled={!hasAnyItems} />
          <SyncTransactionsButton disabled={!hasAnyItems} />
        </div>
```

- [ ] **Step 4: Pass the suggestion prop into the select**

In the table body, replace the existing select usage:

```tsx
                        <TransactionCategorySelect
                          transactionId={t.id}
                          value={t.userCategoryId}
                          categories={categories}
                        />
```

with:

```tsx
                        <TransactionCategorySelect
                          transactionId={t.id}
                          value={t.userCategoryId}
                          categories={categories}
                          suggestion={
                            t.userCategoryId == null && t.suggestedCategoryId
                              ? {
                                  id: t.suggestedCategoryId,
                                  name: t.suggestedCategoryName ?? "",
                                  confidence:
                                    (t.suggestedConfidence as
                                      | "HIGH"
                                      | "MEDIUM"
                                      | "LOW") ?? "LOW",
                                }
                              : null
                          }
                        />
```

- [ ] **Step 5: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/suggest-categories-button.tsx "src/app/(app)/transactions/page.tsx"
git commit -m "feat(categorization): surface suggestions and backfill button on transactions page"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit tests**

Run: `npm test`
Expected: PASS (all engine tests green).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (no new errors in the created/modified files).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds; the new `/api/transactions/suggest-categories` route appears in the route list.

- [ ] **Step 5: Manual smoke (optional, requires DB + linked sandbox item)**

1. Run `npm run dev`, sign in, open `/transactions`.
2. Click **Sync** — newly imported rows should show `Suggested: <category>` under the dropdown for uncategorized transactions.
3. Click **Suggest categories** — the message reports how many were updated; rows that were previously blank now show suggestions (including recurring-stream ones as "Subscriptions").
4. Click **Confirm** on a suggestion — the dropdown switches to that category and "Saved as …" appears; the suggestion line disappears.

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(categorization): verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** rule engine (Task 1), 5 suggestion columns + migration (Task 2), sync-time compute + backfill helper (Task 3), backfill route (Task 4), suggestion UI + Confirm reusing the existing categorize route (Task 5), page wiring + Suggest button (Task 6), tsx/node:test harness (Task 1 + Task 7). All spec sections map to a task.
- **Documented deviation:** curated merchant rules narrowed to netflix/spotify/adobe/amazon prime (apple/google excluded as over-broad) — called out in Task 1.
- **Type consistency:** `SuggestionInput`, `CategorySuggestion`, `suggestCategory`, `computeSuggestedFields`, `loadCategoryIdByName`, `applySuggestionsForUser`, and the `suggested*` column names are used identically across engine, helper, sync, route, and UI. The `confidence` union `"HIGH" | "MEDIUM" | "LOW"` matches between engine and select prop.
