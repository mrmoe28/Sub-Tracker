import { prisma } from "@/lib/prisma";
import { getMonthlyRecurringSpend } from "@/lib/spend-history";
import { formatCurrency } from "@/lib/utils";

export type InsightSeverity = "high" | "medium" | "low";

export type InsightKind =
  | "category-mover"
  | "spend-drift"
  | "price-hike"
  | "review-pileup"
  | "concentration";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
}

const PFC_LABELS: Record<string, string> = {
  FOOD_AND_DRINK: "Food & drink",
  TRANSPORTATION: "Transport",
  TRAVEL: "Travel",
  ENTERTAINMENT: "Entertainment",
  GENERAL_MERCHANDISE: "Shopping",
  GENERAL_SERVICES: "Services",
  HOME_IMPROVEMENT: "Home",
  PERSONAL_CARE: "Personal care",
  MEDICAL: "Medical",
  RENT_AND_UTILITIES: "Rent & utilities",
  LOAN_PAYMENTS: "Loans",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  BANK_FEES: "Bank fees",
  GOVERNMENT_AND_NON_PROFIT: "Government",
  INCOME: "Income",
  OTHER: "Other",
};

function labelCategory(pfc: string): string {
  return (
    PFC_LABELS[pfc] ??
    pfc
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase())
  );
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthName(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long" });
}

// ---------- rules ----------

/**
 * R1: Top category movers month-over-month. Surfaces the single category
 * whose spend swung the most (in $) since last calendar month.
 */
async function ruleCategoryMover(userId: string): Promise<Insight | null> {
  const lookback = new Date();
  lookback.setMonth(lookback.getMonth() - 1);
  const startWindow = startOfMonth(lookback);

  const rows = await prisma.$queryRaw<
    { category: string | null; month: Date; total: string }[]
  >`
    SELECT
      "pfcPrimary" AS category,
      DATE_TRUNC('month', "date") AS month,
      SUM("amount")::text AS total
    FROM "Transaction"
    WHERE
      "userId" = ${userId}
      AND "date" >= ${startWindow}
      AND "amount" > 0
    GROUP BY "pfcPrimary", DATE_TRUNC('month', "date")
  `;

  const thisMonth = startOfMonth(new Date());
  const lastMonth = new Date(
    thisMonth.getFullYear(),
    thisMonth.getMonth() - 1,
    1,
  );
  type Slot = { thisM: number; lastM: number };
  const map = new Map<string, Slot>();
  for (const r of rows) {
    const key = r.category ?? "OTHER";
    let slot = map.get(key);
    if (!slot) {
      slot = { thisM: 0, lastM: 0 };
      map.set(key, slot);
    }
    if (r.month.getTime() === thisMonth.getTime())
      slot.thisM = Number(r.total);
    else if (r.month.getTime() === lastMonth.getTime())
      slot.lastM = Number(r.total);
  }

  let top: { category: string; delta: number; pct: number } | null = null;
  for (const [category, { thisM, lastM }] of map.entries()) {
    if (lastM < 25 || thisM < 25) continue; // ignore noise
    const delta = thisM - lastM;
    const pct = delta / lastM;
    if (Math.abs(pct) < 0.15) continue;
    if (!top || Math.abs(delta) > Math.abs(top.delta)) {
      top = { category, delta, pct };
    }
  }

  if (!top) return null;
  const isUp = top.delta > 0;
  return {
    id: `category-mover:${top.category}`,
    kind: "category-mover",
    severity: "medium",
    title: `${labelCategory(top.category)} ${isUp ? "up" : "down"} ${Math.abs(
      Math.round(top.pct * 100),
    )}% vs ${monthName(lastMonth)}`,
    body: `${formatCurrency(
      Math.abs(top.delta).toFixed(2),
    )} ${isUp ? "more" : "less"} this month so far.`,
    actionHref: "/transactions",
    actionLabel: "See transactions",
  };
}

/**
 * R2: Recurring-spend drift. Compares this month's recurring outflow to
 * the trailing 3-month average; surfaces if it's drifted >10%.
 */
async function ruleSpendDrift(userId: string): Promise<Insight | null> {
  const history = await getMonthlyRecurringSpend(userId, 4);
  if (history.length < 4) return null;

  const prior = history.slice(0, 3);
  const current = history[3];
  const avg = prior.reduce((s, b) => s + b.total, 0) / prior.length;
  if (avg < 25) return null;

  const delta = current.total - avg;
  const pct = delta / avg;
  if (Math.abs(pct) < 0.1) return null;

  const isUp = delta > 0;
  return {
    id: "spend-drift",
    kind: "spend-drift",
    severity: isUp ? "medium" : "low",
    title: `Recurring spend ${isUp ? "above" : "below"} 3-month average`,
    body: `${formatCurrency(current.total.toFixed(2))} this month vs ${formatCurrency(
      avg.toFixed(2),
    )} avg — ${isUp ? "up" : "down"} ${Math.abs(Math.round(pct * 100))}%.`,
  };
}

/**
 * R3: Price hike. A recurring stream's most recent charge jumped >15%
 * from the average of the prior occurrences.
 */
async function rulePriceHike(userId: string): Promise<Insight | null> {
  const streams = await prisma.recurringStream.findMany({
    where: { userId, isActive: true, isInflow: false },
    select: {
      id: true,
      merchantName: true,
      description: true,
      transactions: {
        orderBy: { date: "desc" },
        take: 4,
        select: { amount: true },
      },
    },
  });

  let top: { merchant: string; oldAmt: number; newAmt: number } | null = null;
  for (const s of streams) {
    if (s.transactions.length < 2) continue;
    const newest = Number(s.transactions[0].amount);
    const prior = s.transactions.slice(1).map((t) => Number(t.amount));
    const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
    if (priorAvg < 5) continue;
    const pct = (newest - priorAvg) / priorAvg;
    if (pct < 0.15) continue;
    const merchant = s.merchantName ?? s.description ?? "A subscription";
    const liftDollars = newest - priorAvg;
    if (!top || liftDollars > top.newAmt - top.oldAmt) {
      top = { merchant, oldAmt: priorAvg, newAmt: newest };
    }
  }

  if (!top) return null;
  return {
    id: "price-hike",
    kind: "price-hike",
    severity: "high",
    title: `${top.merchant} raised price`,
    body: `Latest charge ${formatCurrency(
      top.newAmt.toFixed(2),
    )} vs ${formatCurrency(top.oldAmt.toFixed(2))} prior avg.`,
    actionHref: "/subscriptions",
    actionLabel: "Review",
  };
}

/**
 * R4: Pending-review pile-up. Detected subs that haven't been confirmed
 * or ignored — surfaces when the queue is non-trivial.
 */
async function ruleReviewPileup(userId: string): Promise<Insight | null> {
  const count = await prisma.subscriptionCandidate.count({
    where: { userId, status: "PENDING_REVIEW" },
  });
  if (count < 3) return null;
  return {
    id: "review-pileup",
    kind: "review-pileup",
    severity: "high",
    title: `${count} subscriptions need review`,
    body: "Confirm or ignore detected subs to keep your tracker accurate.",
    actionHref: "/subscriptions",
    actionLabel: "Review now",
  };
}

/**
 * R5: Concentration. A single confirmed sub eating ≥25% of recurring spend.
 * Useful for "do I really need this?" prompts on the heaviest line item.
 */
async function ruleConcentration(userId: string): Promise<Insight | null> {
  const subs = await prisma.subscriptionCandidate.findMany({
    where: { userId, status: "CONFIRMED" },
    select: { id: true, name: true, normalizedMonthlyAmount: true },
  });
  if (subs.length < 4) return null;

  const total = subs.reduce(
    (s, c) => s + Number(c.normalizedMonthlyAmount ?? 0),
    0,
  );
  if (total < 50) return null;

  let top = subs[0];
  for (const s of subs) {
    if (
      Number(s.normalizedMonthlyAmount ?? 0) >
      Number(top.normalizedMonthlyAmount ?? 0)
    ) {
      top = s;
    }
  }
  const topAmt = Number(top.normalizedMonthlyAmount ?? 0);
  const pct = topAmt / total;
  if (pct < 0.25) return null;

  return {
    id: `concentration:${top.id}`,
    kind: "concentration",
    severity: "low",
    title: `${top.name} is ${Math.round(pct * 100)}% of your recurring spend`,
    body: `${formatCurrency(topAmt.toFixed(2))} of ${formatCurrency(
      total.toFixed(2),
    )} monthly. Worth a closer look?`,
    actionHref: "/subscriptions",
    actionLabel: "Review",
  };
}

// ---------- top-level ----------

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export async function getInsights(userId: string): Promise<Insight[]> {
  const results = await Promise.all([
    ruleCategoryMover(userId),
    ruleSpendDrift(userId),
    rulePriceHike(userId),
    ruleReviewPileup(userId),
    ruleConcentration(userId),
  ]);
  return results
    .filter((i): i is Insight => i != null)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
