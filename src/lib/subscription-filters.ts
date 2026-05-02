// Heuristics for excluding obvious non-subscriptions from candidate creation.
//
// Three signals, evaluated in order (cheapest first):
//   1. Plaid `personal_finance_category.primary` (preferred — more accurate
//      than the legacy categories).
//   2. Legacy Plaid `category` array.
//   3. Name regex (last resort, mostly for institutions that don't
//      categorize cleanly).
//
// Returning `true` from `looksLikeNonSubscription` means: don't surface this
// as a SubscriptionCandidate. We deliberately bias toward false negatives
// (let edge cases through and let the user dismiss) over false positives.

const NON_SUB_PFC_PRIMARY = new Set([
  "INCOME",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "RENT_AND_UTILITIES",
  "BANK_FEES",
]);

const NON_SUB_LEGACY_CATEGORY_FRAGMENTS = [
  "transfer",
  "payroll",
  "deposit",
  "credit card",
  "mortgage",
  "rent",
  "utilities",
  "loan",
  "tax",
  "atm",
  "interest",
  "overdraft",
];

// Match common payee strings that are very unlikely to be subscriptions.
const NON_SUB_NAME_PATTERNS: RegExp[] = [
  /\b(payroll|direct\s*dep(osit)?|salary|wages)\b/i,
  /\b(transfer|venmo|zelle|cash\s*app|paypal\s*(inst|tran))\b/i,
  /\b(cc\s*(pay|pmt)|credit\s*card\s*(pay|pmt|payment)|amex\s*pymt|chase\s*epay)\b/i,
  /\b(mortgage|rent\s*payment)\b/i,
  /\b(electric\s*co|gas\s*co(mpany)?|water\s*(dept|util)|utility|comcast)\b/i,
  /\b(irs|tax\s*pmt|state\s*tax)\b/i,
  /\batm\s*(withdraw|w\/d|wd)\b/i,
];

export interface NonSubInput {
  name?: string | null;
  merchantName?: string | null;
  pfcPrimary?: string | null;
  category?: string[] | null;
  amount?: number | null; // Plaid: positive = outflow
}

export function looksLikeNonSubscription(input: NonSubInput): boolean {
  // Inflows (refunds, deposits, etc.) — only outflows count as subscriptions.
  if (typeof input.amount === "number" && input.amount <= 0) {
    return true;
  }

  if (input.pfcPrimary && NON_SUB_PFC_PRIMARY.has(input.pfcPrimary)) {
    return true;
  }

  const cats = input.category ?? [];
  for (const c of cats) {
    const lower = c.toLowerCase();
    if (NON_SUB_LEGACY_CATEGORY_FRAGMENTS.some((f) => lower.includes(f))) {
      return true;
    }
  }

  const haystack = `${input.merchantName ?? ""} ${input.name ?? ""}`.trim();
  if (haystack && NON_SUB_NAME_PATTERNS.some((re) => re.test(haystack))) {
    return true;
  }

  return false;
}
