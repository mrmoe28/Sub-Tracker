import "server-only";

import {
  RecurringTransactionFrequency,
  TransactionStreamStatus,
  type TransactionStream,
} from "plaid";
import {
  Prisma,
  type SubscriptionCandidate,
  type Transaction,
} from "@prisma/client";

import { prisma } from "./prisma";
import { getPlaidClient } from "./plaid";
import { ensureMerchant } from "./merchant";
import { safeLogError } from "./safe-error";
import { decryptToken } from "./token-encryption";
import { looksLikeNonSubscription } from "./subscription-filters";

// ---------- Frequency / amount helpers ----------

const PLAID_FREQUENCY_MAP: Record<
  RecurringTransactionFrequency,
  "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "ANNUALLY" | "UNKNOWN"
> = {
  [RecurringTransactionFrequency.Weekly]: "WEEKLY",
  [RecurringTransactionFrequency.Biweekly]: "BIWEEKLY",
  [RecurringTransactionFrequency.SemiMonthly]: "SEMI_MONTHLY",
  [RecurringTransactionFrequency.Monthly]: "MONTHLY",
  [RecurringTransactionFrequency.Annually]: "ANNUALLY",
  [RecurringTransactionFrequency.Unknown]: "UNKNOWN",
};

const PLAID_STATUS_MAP: Record<
  TransactionStreamStatus,
  "MATURE" | "EARLY_DETECTION" | "TOMBSTONED" | "UNKNOWN"
> = {
  [TransactionStreamStatus.Mature]: "MATURE",
  [TransactionStreamStatus.EarlyDetection]: "EARLY_DETECTION",
  [TransactionStreamStatus.Tombstoned]: "TOMBSTONED",
  [TransactionStreamStatus.Unknown]: "UNKNOWN",
};

type Frequency =
  | "WEEKLY"
  | "BIWEEKLY"
  | "SEMI_MONTHLY"
  | "MONTHLY"
  | "ANNUALLY"
  | "UNKNOWN";

// Convert any cadence to a comparable monthly figure for sorting/totals.
export function normalizedMonthlyAmount(
  amount: number,
  frequency: Frequency,
): number {
  switch (frequency) {
    case "WEEKLY":
      return (amount * 52) / 12;
    case "BIWEEKLY":
      return (amount * 26) / 12;
    case "SEMI_MONTHLY":
      return amount * 2;
    case "MONTHLY":
      return amount;
    case "ANNUALLY":
      return amount / 12;
    default:
      return amount;
  }
}

function parsePlaidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`);
}

// ---------- Layer 1: Plaid recurring streams ----------

function mapStreamConfidence(status: TransactionStreamStatus): {
  enumValue: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  score: number;
} {
  // Plaid's TransactionStream doesn't expose a discrete confidence enum in
  // this SDK version, so we derive one from `status`.
  switch (status) {
    case TransactionStreamStatus.Mature:
      return { enumValue: "HIGH", score: 0.9 };
    case TransactionStreamStatus.EarlyDetection:
      return { enumValue: "MEDIUM", score: 0.65 };
    case TransactionStreamStatus.Tombstoned:
      return { enumValue: "LOW", score: 0.4 };
    default:
      return { enumValue: "UNKNOWN", score: 0.5 };
  }
}

interface RecurringSyncResult {
  streamsUpserted: number;
  candidatesUpserted: number;
  candidatesSkipped: number;
}

export async function syncRecurringStreams(
  plaidItemId: string,
  userId: string,
): Promise<RecurringSyncResult> {
  // SECURITY: scope by userId. See note in syncPlaidItemTransactions.
  const item = await prisma.plaidItem.findFirstOrThrow({
    where: { id: plaidItemId, userId },
    include: { accounts: true },
  });

  const accessToken = decryptToken({
    accessTokenCiphertext: item.accessTokenCiphertext,
    accessTokenIv: item.accessTokenIv,
    accessTokenAuthTag: item.accessTokenAuthTag,
    encryptionKeyVersion: item.encryptionKeyVersion,
  });

  const plaid = getPlaidClient();
  const response = await plaid.transactionsRecurringGet({
    access_token: accessToken,
  });

  const accountIdByPlaidId = new Map(
    item.accounts.map((a) => [a.plaidAccountId, a.id]),
  );

  let streamsUpserted = 0;
  let candidatesUpserted = 0;
  let candidatesSkipped = 0;

  // Process both inflow and outflow streams so the RecurringStream table is a
  // faithful mirror of what Plaid sees. Only outflow streams that pass the
  // filter become SubscriptionCandidates.
  const allStreams: Array<{ stream: TransactionStream; isInflow: boolean }> = [
    ...response.data.outflow_streams.map((s) => ({
      stream: s,
      isInflow: false,
    })),
    ...response.data.inflow_streams.map((s) => ({
      stream: s,
      isInflow: true,
    })),
  ];

  for (const { stream, isInflow } of allStreams) {
    const merchant = await ensureMerchant(
      stream.merchant_name ?? stream.description,
    );
    const accountDbId = accountIdByPlaidId.get(stream.account_id) ?? null;
    const frequency = PLAID_FREQUENCY_MAP[stream.frequency] ?? "UNKNOWN";
    const status = PLAID_STATUS_MAP[stream.status] ?? "UNKNOWN";
    const { enumValue: confEnum, score: confScore } = mapStreamConfidence(
      stream.status,
    );

    const lastAmount = stream.last_amount?.amount ?? null;
    const averageAmount = stream.average_amount?.amount ?? null;
    const isoCurrency =
      stream.last_amount?.iso_currency_code ??
      stream.average_amount?.iso_currency_code ??
      null;

    const streamRow = await prisma.recurringStream.upsert({
      where: { plaidStreamId: stream.stream_id },
      update: {
        userId: item.userId,
        accountId: accountDbId,
        merchantId: merchant?.id ?? null,
        isInflow,
        description: stream.description ?? null,
        merchantName: stream.merchant_name ?? null,
        frequency,
        status,
        confidence: confEnum,
        isActive: stream.is_active,
        averageAmount: averageAmount != null ? averageAmount.toString() : null,
        lastAmount: lastAmount != null ? lastAmount.toString() : null,
        isoCurrencyCode: isoCurrency,
        firstDate: parsePlaidDate(stream.first_date),
        lastDate: parsePlaidDate(stream.last_date),
        predictedNextDate: parsePlaidDate(stream.predicted_next_date),
        raw: stream as unknown as Prisma.InputJsonValue,
      },
      create: {
        userId: item.userId,
        accountId: accountDbId,
        merchantId: merchant?.id ?? null,
        plaidStreamId: stream.stream_id,
        isInflow,
        description: stream.description ?? null,
        merchantName: stream.merchant_name ?? null,
        frequency,
        status,
        confidence: confEnum,
        isActive: stream.is_active,
        averageAmount: averageAmount != null ? averageAmount.toString() : null,
        lastAmount: lastAmount != null ? lastAmount.toString() : null,
        isoCurrencyCode: isoCurrency,
        firstDate: parsePlaidDate(stream.first_date),
        lastDate: parsePlaidDate(stream.last_date),
        predictedNextDate: parsePlaidDate(stream.predicted_next_date),
        raw: stream as unknown as Prisma.InputJsonValue,
      },
    });

    streamsUpserted += 1;

    // Skip candidate creation for inflows and obvious non-subscriptions.
    if (isInflow) {
      candidatesSkipped += 1;
      continue;
    }
    const filterInput = {
      name: stream.description,
      merchantName: stream.merchant_name,
      pfcPrimary: stream.personal_finance_category?.primary ?? null,
      category: stream.category,
      amount: lastAmount,
    };
    if (looksLikeNonSubscription(filterInput)) {
      candidatesSkipped += 1;
      continue;
    }

    const candidateName =
      (stream.merchant_name?.trim() || stream.description?.trim()) ??
      "Unknown subscription";
    const monthly =
      lastAmount != null
        ? normalizedMonthlyAmount(Math.abs(lastAmount), frequency)
        : null;

    // Tombstoned streams that were never confirmed move to ARCHIVED. Active
    // streams default to PENDING_REVIEW. Existing user decisions are
    // preserved by only setting status on create.
    const newStatus =
      status === "TOMBSTONED" ? "ARCHIVED" : "PENDING_REVIEW";

    await prisma.subscriptionCandidate.upsert({
      where: {
        userId_recurringStreamId: {
          userId: item.userId,
          recurringStreamId: streamRow.id,
        },
      },
      update: {
        merchantId: merchant?.id ?? null,
        name: candidateName,
        frequency,
        lastAmount: lastAmount != null ? Math.abs(lastAmount).toString() : null,
        normalizedMonthlyAmount: monthly != null ? monthly.toFixed(2) : null,
        isoCurrencyCode: isoCurrency,
        firstSeenAt: parsePlaidDate(stream.first_date),
        lastSeenAt: parsePlaidDate(stream.last_date),
        predictedNextDate: parsePlaidDate(stream.predicted_next_date),
        confidence: confScore,
      },
      create: {
        userId: item.userId,
        merchantId: merchant?.id ?? null,
        recurringStreamId: streamRow.id,
        source: "PLAID_STREAM",
        status: newStatus,
        name: candidateName,
        frequency,
        lastAmount: lastAmount != null ? Math.abs(lastAmount).toString() : null,
        normalizedMonthlyAmount: monthly != null ? monthly.toFixed(2) : null,
        isoCurrencyCode: isoCurrency,
        firstSeenAt: parsePlaidDate(stream.first_date),
        lastSeenAt: parsePlaidDate(stream.last_date),
        predictedNextDate: parsePlaidDate(stream.predicted_next_date),
        confidence: confScore,
      },
    });

    candidatesUpserted += 1;
  }

  return { streamsUpserted, candidatesUpserted, candidatesSkipped };
}

// ---------- Layer 2: heuristic detection on local transactions ----------

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function coefficientOfVariation(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (mean === 0) return Infinity;
  const variance =
    nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function classifyIntervalDays(days: number): Frequency {
  if (days >= 5 && days <= 9) return "WEEKLY";
  if (days >= 12 && days <= 17) return "BIWEEKLY";
  if (days >= 13 && days <= 17) return "SEMI_MONTHLY";
  if (days >= 25 && days <= 35) return "MONTHLY";
  if (days >= 85 && days <= 95) return "MONTHLY"; // quarterly → bucket as monthly for now
  if (days >= 350 && days <= 380) return "ANNUALLY";
  return "UNKNOWN";
}

interface HeuristicResult {
  evaluated: number;
  candidatesUpserted: number;
}

export async function detectHeuristicCandidates(
  userId: string,
): Promise<HeuristicResult> {
  // Pull posted, non-pending outflows for this user. Pending transactions
  // shift dates around and would destabilize cadence detection.
  const txns = await prisma.transaction.findMany({
    where: { userId, pending: false },
    orderBy: { date: "asc" },
  });

  // Group by merchantId, falling back to a normalized name key.
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (
      looksLikeNonSubscription({
        name: t.name,
        merchantName: t.merchantName,
        pfcPrimary: t.pfcPrimary,
        category: t.category,
        amount: Number(t.amount),
      })
    ) {
      continue;
    }
    const key =
      t.merchantId ??
      `name:${(t.merchantName ?? t.name).trim().toLowerCase()}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  // Skip groups whose merchant already has a Plaid-stream-derived candidate
  // for this user — Plaid's classification wins.
  const merchantsWithPlaid = new Set(
    (
      await prisma.subscriptionCandidate.findMany({
        where: { userId, source: "PLAID_STREAM", merchantId: { not: null } },
        select: { merchantId: true },
      })
    )
      .map((r) => r.merchantId)
      .filter((m): m is string => m !== null),
  );

  let evaluated = 0;
  let candidatesUpserted = 0;

  for (const [key, group] of groups) {
    if (group.length < 3) continue;
    evaluated += 1;

    const merchantId = group[0].merchantId;
    if (merchantId && merchantsWithPlaid.has(merchantId)) {
      continue;
    }

    // Compute consecutive-day intervals.
    const sorted = [...group].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      const days =
        (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) /
        (1000 * 60 * 60 * 24);
      intervals.push(days);
    }
    const medianInterval = median(intervals);
    if (medianInterval < 5) continue; // too frequent — likely not a sub

    const frequency = classifyIntervalDays(medianInterval);
    if (frequency === "UNKNOWN") continue;

    const amounts = sorted.map((t) => Number(t.amount));
    const intervalCV = coefficientOfVariation(intervals);
    const amountCV = coefficientOfVariation(amounts);

    // Confidence: starts at 0.4, rewarded for occurrences and consistency.
    let confidence = 0.4;
    confidence += Math.min(0.3, (sorted.length - 2) * 0.05);
    if (intervalCV < 0.2) confidence += 0.2;
    else if (intervalCV < 0.4) confidence += 0.1;
    if (amountCV < 0.05) confidence += 0.15;
    else if (amountCV < 0.15) confidence += 0.075;
    confidence = Math.min(0.85, confidence);

    const lastTxn = sorted[sorted.length - 1];
    const predictedNext = new Date(lastTxn.date.getTime());
    predictedNext.setUTCDate(
      predictedNext.getUTCDate() + Math.round(medianInterval),
    );

    const lastAmount = Math.abs(Number(lastTxn.amount));
    const monthly = normalizedMonthlyAmount(lastAmount, frequency);

    const name =
      lastTxn.merchantName?.trim() ||
      lastTxn.name?.trim() ||
      key.replace(/^name:/, "");

    // Dedupe heuristic candidates by (userId, merchantId, source=HEURISTIC).
    // We can't use a unique-tuple upsert because merchantId can be null.
    const existing: SubscriptionCandidate | null =
      await prisma.subscriptionCandidate.findFirst({
        where: {
          userId,
          source: "HEURISTIC",
          ...(merchantId
            ? { merchantId }
            : { merchantId: null, name }),
        },
      });

    if (existing) {
      // Don't clobber a user's decision — only refresh metrics.
      await prisma.subscriptionCandidate.update({
        where: { id: existing.id },
        data: {
          frequency,
          lastAmount: lastAmount.toString(),
          normalizedMonthlyAmount: monthly.toFixed(2),
          isoCurrencyCode: lastTxn.isoCurrencyCode,
          firstSeenAt: sorted[0].date,
          lastSeenAt: lastTxn.date,
          predictedNextDate: predictedNext,
          confidence,
        },
      });
    } else {
      await prisma.subscriptionCandidate.create({
        data: {
          userId,
          merchantId,
          source: "HEURISTIC",
          status: "PENDING_REVIEW",
          name,
          frequency,
          lastAmount: lastAmount.toString(),
          normalizedMonthlyAmount: monthly.toFixed(2),
          isoCurrencyCode: lastTxn.isoCurrencyCode,
          firstSeenAt: sorted[0].date,
          lastSeenAt: lastTxn.date,
          predictedNextDate: predictedNext,
          confidence,
        },
      });
    }

    candidatesUpserted += 1;
  }

  return { evaluated, candidatesUpserted };
}

// ---------- Orchestrator ----------

export interface DetectionRunResult {
  plaid: {
    items: number;
    streamsUpserted: number;
    candidatesUpserted: number;
    candidatesSkipped: number;
  };
  heuristic: {
    evaluated: number;
    candidatesUpserted: number;
  };
}

export async function runDetection(
  userId: string,
): Promise<DetectionRunResult> {
  const items = await prisma.plaidItem.findMany({
    where: { userId },
    select: { id: true },
  });

  let streamsUpserted = 0;
  let plaidCandidatesUpserted = 0;
  let plaidCandidatesSkipped = 0;
  for (const item of items) {
    try {
      const r = await syncRecurringStreams(item.id, userId);
      streamsUpserted += r.streamsUpserted;
      plaidCandidatesUpserted += r.candidatesUpserted;
      plaidCandidatesSkipped += r.candidatesSkipped;
    } catch (err) {
      // One bad item shouldn't kill the whole run. Use safeLogError so
      // we never spill the access token from the failed Plaid request.
      safeLogError(`detection.syncRecurringStreams item=${item.id}`, err);
    }
  }

  const heuristic = await detectHeuristicCandidates(userId);

  return {
    plaid: {
      items: items.length,
      streamsUpserted,
      candidatesUpserted: plaidCandidatesUpserted,
      candidatesSkipped: plaidCandidatesSkipped,
    },
    heuristic,
  };
}
