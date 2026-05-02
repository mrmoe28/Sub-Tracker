import type { Merchant, SubscriptionCandidateStatus } from "@prisma/client";
import { ExternalLink } from "lucide-react";

import { DetectSubscriptionsButton } from "@/components/detect-subscriptions-button";
import { SubscriptionRowActions } from "@/components/subscription-row-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { cn, formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FREQUENCY_LABEL: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  SEMI_MONTHLY: "Semi-monthly",
  MONTHLY: "Monthly",
  ANNUALLY: "Annually",
  UNKNOWN: "—",
};

const STATUS_LABEL: Record<SubscriptionCandidateStatus, string> = {
  PENDING_REVIEW: "Needs review",
  CONFIRMED: "Confirmed",
  DISMISSED: "Ignored",
  ARCHIVED: "Canceled",
};

const STATUS_BADGE_CLASS: Record<SubscriptionCandidateStatus, string> = {
  PENDING_REVIEW:
    "bg-yellow-100 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-300",
  CONFIRMED:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  DISMISSED: "bg-muted text-muted-foreground",
  ARCHIVED: "bg-muted text-muted-foreground line-through",
};

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10);
}

function formatConfidence(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

// Pick the best cancellation/contact link we have for this merchant.
// We never fabricate URLs — only render what's curated in the DB.
function getCancelLink(
  m: Merchant | null,
): { url: string; label: string } | null {
  if (!m) return null;
  if (m.cancellationUrl) {
    return { url: m.cancellationUrl, label: "How to cancel" };
  }
  if (m.supportUrl) {
    return { url: m.supportUrl, label: "Vendor support" };
  }
  if (m.website) {
    return { url: m.website, label: "Vendor website" };
  }
  return null;
}

export default async function SubscriptionsPage() {
  const user = await getCurrentUser();
  const hasItems = (await prisma.plaidItem.count({ where: { userId: user.id } })) > 0;

  const candidates = await prisma.subscriptionCandidate.findMany({
    where: { userId: user.id },
    include: {
      merchant: {
        include: {
          cancellationCandidates: {
            where: { status: "PENDING_REVIEW" },
            orderBy: { confidence: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: [
      // Sort: needs review first, then confirmed, then dismissed/archived;
      // within a status, biggest monthly cost first.
      { status: "asc" },
      { normalizedMonthlyAmount: "desc" },
    ],
  });

  const totals = candidates.reduce(
    (acc, c) => {
      const monthly = c.normalizedMonthlyAmount
        ? Number(c.normalizedMonthlyAmount)
        : 0;
      if (c.status === "CONFIRMED") acc.confirmed += monthly;
      if (c.status === "PENDING_REVIEW") acc.pending += monthly;
      return acc;
    },
    { confirmed: 0, pending: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Subscriptions
          </h1>
          <p className="text-sm text-muted-foreground">
            Detected from Plaid recurring streams and our own heuristics.
            Confirm, ignore, or mark them canceled.
          </p>
        </div>
        <DetectSubscriptionsButton disabled={!hasItems} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Confirmed monthly spend</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totals.confirmed.toFixed(2))}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending review</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(totals.pending.toFixed(2))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {candidates.length === 0 ? "No subscriptions yet" : "All subscriptions"}
          </CardTitle>
          <CardDescription>
            {hasItems
              ? "Click Detect to refresh from Plaid streams + our heuristics."
              : "Connect a bank from the dashboard to detect subscriptions."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Merchant</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Cadence</th>
                  <th className="px-4 py-2 text-left font-medium">Last paid</th>
                  <th className="px-4 py-2 text-left font-medium">Next</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Confidence
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  candidates.map((c) => {
                    const monthly = c.normalizedMonthlyAmount
                      ? Number(c.normalizedMonthlyAmount)
                      : null;
                    return (
                      <tr key={c.id} className="border-t align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.source === "PLAID_STREAM"
                              ? "From Plaid"
                              : c.source === "HEURISTIC"
                                ? "Heuristic"
                                : "Manual"}
                          </div>
                          {(() => {
                            const link = getCancelLink(c.merchant);
                            if (!link) return null;
                            return (
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                                title={
                                  c.merchant?.cancellationNotes ?? undefined
                                }
                              >
                                {link.label}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            );
                          })()}
                          {c.merchant?.cancellationCandidates[0] ? (
                            <a
                              href={c.merchant.cancellationCandidates[0].url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 block max-w-[28ch] truncate text-xs text-amber-700 hover:underline dark:text-amber-300"
                              title={
                                c.merchant.cancellationCandidates[0].title ??
                                c.merchant.cancellationCandidates[0].url
                              }
                            >
                              Suggested:{" "}
                              {c.merchant.cancellationCandidates[0].title ??
                                c.merchant.cancellationCandidates[0].url}
                            </a>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <div>
                            {c.lastAmount != null
                              ? formatCurrency(
                                  c.lastAmount.toString(),
                                  c.isoCurrencyCode ?? "USD",
                                )
                              : "—"}
                          </div>
                          {monthly != null &&
                          c.frequency !== "MONTHLY" &&
                          c.frequency !== "UNKNOWN" ? (
                            <div className="text-xs text-muted-foreground">
                              ≈{" "}
                              {formatCurrency(
                                monthly.toFixed(2),
                                c.isoCurrencyCode ?? "USD",
                              )}{" "}
                              /mo
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {FREQUENCY_LABEL[c.frequency] ?? c.frequency}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(c.lastSeenAt)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(c.predictedNextDate)}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {formatConfidence(c.confidence)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs",
                              STATUS_BADGE_CLASS[c.status],
                            )}
                          >
                            {STATUS_LABEL[c.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <SubscriptionRowActions
                            candidateId={c.id}
                            hasCancelUrl={Boolean(
                              getCancelLink(c.merchant),
                            )}
                            pendingCancellationCandidateId={
                              c.merchant?.cancellationCandidates[0]?.id ?? null
                            }
                            status={c.status}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
