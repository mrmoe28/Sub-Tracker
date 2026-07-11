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
