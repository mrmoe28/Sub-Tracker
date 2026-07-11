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
