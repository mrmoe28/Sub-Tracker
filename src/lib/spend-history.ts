import { prisma } from "@/lib/prisma";

export interface SpendBucket {
  month: Date;
  total: number;
  label: string;
}

/**
 * Monthly outflow from transactions tagged to a Plaid recurring stream.
 * Misses HEURISTIC-only subs whose transactions aren't linked to a stream;
 * acceptable for trend visualization, not for accounting.
 */
export async function getMonthlyRecurringSpend(
  userId: string,
  months = 12,
): Promise<SpendBucket[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const rows = await prisma.$queryRaw<
    { month: Date; total: string }[]
  >`
    SELECT
      DATE_TRUNC('month', "date") AS month,
      SUM("amount")::text AS total
    FROM "Transaction"
    WHERE
      "userId" = ${userId}
      AND "date" >= ${start}
      AND "recurringStreamId" IS NOT NULL
      AND "amount" > 0
    GROUP BY month
    ORDER BY month ASC;
  `;

  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.month.toISOString().slice(0, 7);
    map.set(key, Number(row.total));
  }

  const buckets: SpendBucket[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = d.toISOString().slice(0, 7);
    buckets.push({
      month: d,
      total: map.get(key) ?? 0,
      label: d.toLocaleDateString("en-US", { month: "short" }),
    });
  }

  return buckets;
}
