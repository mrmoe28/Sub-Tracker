import Link from "next/link";
import type { PlaidItemStatus } from "@prisma/client";

import { ConnectBankButton } from "@/components/connect-bank-button";
import { DashboardReviewActions } from "@/components/dashboard-review-actions";
import { InsightStrip } from "@/components/insight-strip";
import { SpendChart } from "@/components/spend-chart";
import { SyncTransactionsButton } from "@/components/sync-transactions-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getMonthlyRecurringSpend } from "@/lib/spend-history";
import { getInsights } from "@/lib/spend-insights";
import { cn, formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

// ---------- presentation helpers ----------

const MARK_PALETTE = [
  "oklch(0.55 0.10 25)",
  "oklch(0.55 0.10 60)",
  "oklch(0.50 0.09 145)",
  "oklch(0.50 0.10 200)",
  "oklch(0.50 0.10 260)",
  "oklch(0.50 0.10 310)",
  "oklch(0.45 0.05 0)",
  "oklch(0.50 0.08 90)",
];

function markColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return MARK_PALETTE[Math.abs(hash) % MARK_PALETTE.length];
}

function MerchantMark({ name }: { name: string }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
      style={{ background: markColor(name) }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function describeWhen(date: Date | null): { label: string; soon: boolean } {
  if (!date) return { label: "—", soon: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const days = Math.round(
    (target.getTime() - today.getTime()) / 86_400_000,
  );
  const monthDay = target.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (days < 0)
    return { label: `${Math.abs(days)}d ago · ${monthDay}`, soon: false };
  if (days === 0) return { label: `Today · ${monthDay}`, soon: true };
  if (days === 1) return { label: `Tomorrow · ${monthDay}`, soon: true };
  return { label: `In ${days} days · ${monthDay}`, soon: days <= 2 };
}

function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

function institutionStatus(
  status: PlaidItemStatus,
): { label: string; tone: "ok" | "warn" } {
  switch (status) {
    case "ACTIVE":
      return { label: "Healthy", tone: "ok" };
    case "LOGIN_REQUIRED":
      return { label: "Reauth needed", tone: "warn" };
    case "ERROR":
      return { label: "Sync error", tone: "warn" };
    case "REVOKED":
      return { label: "Disconnected", tone: "warn" };
  }
}

function ConfBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const isLow = value < 0.7;
  return (
    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full",
          isLow ? "bg-amber-500" : "bg-emerald-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const SOURCE_LABEL = {
  PLAID_STREAM: "Plaid",
  HEURISTIC: "Heuristic",
  USER: "Manual",
} as const;

// ---------- page ----------

export default async function DashboardPage() {
  const user = await getCurrentUser();

  const now = new Date();
  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);
  const monthLabel = now
    .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    .toUpperCase();

  // SECURITY: explicit `select` so the access-token ciphertext, IV, auth
  // tag, key version, and the transactions cursor are never loaded into
  // a server component's scope (and therefore can't accidentally leak via
  // the RSC payload if a future client component receives this data).
  const [items, txnCount, confirmed, pendingReview, upcoming, spendHistory, insights] =
    await Promise.all([
      prisma.plaidItem.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          institutionName: true,
          status: true,
          lastSyncedAt: true,
          createdAt: true,
          accounts: {
            select: { id: true, name: true, mask: true, subtype: true, type: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.transaction.count({ where: { userId: user.id } }),
      prisma.subscriptionCandidate.findMany({
        where: { userId: user.id, status: "CONFIRMED" },
        select: { id: true, normalizedMonthlyAmount: true },
      }),
      prisma.subscriptionCandidate.findMany({
        where: { userId: user.id, status: "PENDING_REVIEW" },
        orderBy: [{ normalizedMonthlyAmount: "desc" }, { confidence: "desc" }],
        take: 3,
        select: {
          id: true,
          name: true,
          source: true,
          frequency: true,
          lastAmount: true,
          isoCurrencyCode: true,
          confidence: true,
        },
      }),
      prisma.subscriptionCandidate.findMany({
        where: {
          userId: user.id,
          status: "CONFIRMED",
          predictedNextDate: { gte: now, lte: in7Days },
        },
        orderBy: { predictedNextDate: "asc" },
        take: 5,
        select: {
          id: true,
          name: true,
          lastAmount: true,
          isoCurrencyCode: true,
          predictedNextDate: true,
        },
      }),
      getMonthlyRecurringSpend(user.id, 12),
      getInsights(user.id),
    ]);

  const monthlyTotal = confirmed.reduce(
    (acc, c) => acc + Number(c.normalizedMonthlyAmount ?? 0),
    0,
  );
  const annualTotal = monthlyTotal * 12;
  const accountCount = items.reduce((n, i) => n + i.accounts.length, 0);
  const upcomingTotal = upcoming.reduce(
    (acc, c) => acc + Number(c.lastAmount ?? 0),
    0,
  );
  const lastSync = items[0]?.lastSyncedAt ?? null;
  const pendingTotalCount = await prisma.subscriptionCandidate.count({
    where: { userId: user.id, status: "PENDING_REVIEW" },
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Tracking{" "}
            <span className="font-medium text-foreground">
              {confirmed.length} subscription{confirmed.length === 1 ? "" : "s"}
            </span>{" "}
            across {items.length} bank{items.length === 1 ? "" : "s"}
            {lastSync ? (
              <>
                {" · last sync "}
                <span className="font-mono text-xs">
                  {relativeTime(lastSync)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SyncTransactionsButton disabled={items.length === 0} />
          <ConnectBankButton />
        </div>
      </div>

      {/* Insights — surfaced rules, hidden if none */}
      <InsightStrip insights={insights} />

      {/* KPI strip — single hairline grid, hero metric + 3 supporting */}
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border bg-background sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="border-b p-5 sm:border-b-0 sm:border-r lg:border-r">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Monthly recurring spend</span>
            <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
              {monthLabel}
            </span>
          </div>
          <div className="mt-2 inline-block">
            <div className="text-4xl font-semibold tracking-tight tabular-nums">
              {formatCurrency(monthlyTotal)}
            </div>
            <div className="mt-1.5 h-[3px] w-12 rounded-full bg-brand" />
          </div>
          <div className="mt-2 font-mono text-xs text-muted-foreground">
            From {confirmed.length} confirmed subscription
            {confirmed.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="border-b p-5 sm:border-r sm:border-b-0">
          <div className="text-xs text-muted-foreground">
            Active subscriptions
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {confirmed.length}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {pendingTotalCount > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                +{pendingTotalCount} need
                {pendingTotalCount === 1 ? "s" : ""} review
              </span>
            ) : (
              "all reviewed"
            )}
          </div>
        </div>
        <div className="border-b p-5 lg:border-r lg:border-b-0">
          <div className="text-xs text-muted-foreground">Linked accounts</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {accountCount}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            across {items.length} bank{items.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="p-5">
          <div className="text-xs text-muted-foreground">Annualized spend</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {formatCurrency(annualTotal)}
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {txnCount.toLocaleString()} txns imported
          </div>
        </div>
      </div>

      {/* Spend trend + Upcoming */}
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Spend over time */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle>Spend over time</CardTitle>
            <CardDescription>
              Monthly recurring outflow, last 12 months
            </CardDescription>
          </CardHeader>
          <CardContent className="px-3 pb-4">
            <SpendChart data={spendHistory} />
          </CardContent>
        </Card>

        {/* Upcoming charges */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle>Upcoming charges</CardTitle>
            <CardDescription>
              Next 7 days, predicted from past cadence
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {upcoming.length === 0 ? (
              <div className="px-6 pb-6 text-sm text-muted-foreground">
                {confirmed.length === 0
                  ? "Confirm some subscriptions to see upcoming charges."
                  : "Nothing predicted in the next 7 days."}
              </div>
            ) : (
              <ul>
                {upcoming.map((c) => {
                  const when = describeWhen(c.predictedNextDate);
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 border-t px-6 py-3"
                    >
                      <MerchantMark name={c.name} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {c.name}
                        </div>
                        <div
                          className={cn(
                            "text-xs",
                            when.soon
                              ? "font-medium text-brand-deep dark:text-brand"
                              : "text-muted-foreground",
                          )}
                        >
                          {when.label}
                        </div>
                      </div>
                      <div className="font-mono text-sm tabular-nums">
                        {c.lastAmount
                          ? formatCurrency(
                              c.lastAmount.toString(),
                              c.isoCurrencyCode ?? "USD",
                            )
                          : "—"}
                      </div>
                    </li>
                  );
                })}
                <li className="flex items-center justify-between border-t px-6 py-3 text-xs">
                  <span className="text-muted-foreground">
                    Total this week
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {formatCurrency(upcomingTotal)}
                  </span>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Needs review — full width 3-card grid */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-baseline justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle>
              Needs review
              {pendingTotalCount > 0 ? (
                <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                  {pendingTotalCount}
                </span>
              ) : null}
            </CardTitle>
            <CardDescription>
              Detected but unconfirmed — confirm or ignore to clean up your list
            </CardDescription>
          </div>
          <Link
            href="/subscriptions"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            View all →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {pendingReview.length === 0 ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">
              {items.length === 0
                ? "Connect a bank to detect subscriptions."
                : "Nothing to review. Run detection from the Subscriptions page."}
            </div>
          ) : (
            <div className="grid gap-px border-t bg-border sm:grid-cols-2 lg:grid-cols-3">
              {pendingReview.map((c) => (
                <div key={c.id} className="flex flex-col gap-3 bg-background p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {c.name}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground/80">
                        {SOURCE_LABEL[c.source]} ·{" "}
                        {c.frequency.toLowerCase().replace(/_/g, " ")}
                      </div>
                    </div>
                    <div className="font-mono text-sm tabular-nums">
                      {c.lastAmount
                        ? formatCurrency(
                            c.lastAmount.toString(),
                            c.isoCurrencyCode ?? "USD",
                          )
                        : "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ConfBar value={c.confidence ?? 0} />
                    <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {c.confidence != null
                        ? `${Math.round(c.confidence * 100)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-auto">
                    <DashboardReviewActions candidateId={c.id} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected institutions */}
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-baseline justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle>Connected institutions</CardTitle>
            <CardDescription>
              {items.length} connected · Plaid sandbox
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="mx-6 mb-6 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No banks connected yet. Click &ldquo;Connect bank&rdquo; to get
              started.
            </div>
          ) : (
            <ul>
              {items.map((item) => {
                const st = institutionStatus(item.status);
                const accountSummary = item.accounts.length
                  ? item.accounts
                      .slice(0, 3)
                      .map((a) => a.name)
                      .join(" · ")
                  : "no accounts";
                return (
                  <li
                    key={item.id}
                    className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border-t px-6 py-4 sm:grid-cols-[auto_1fr_auto_auto]"
                  >
                    <MerchantMark
                      name={item.institutionName ?? "Unknown"}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {item.institutionName ?? "Unknown institution"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.accounts.length} account
                        {item.accounts.length === 1 ? "" : "s"} ·{" "}
                        {accountSummary}
                        {item.accounts.length > 3
                          ? ` · +${item.accounts.length - 3} more`
                          : ""}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs",
                        st.tone === "warn"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          st.tone === "warn"
                            ? "bg-amber-500"
                            : "bg-emerald-500",
                        )}
                      />
                      {st.label}
                    </div>
                    <div className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">
                      {item.lastSyncedAt
                        ? relativeTime(item.lastSyncedAt)
                        : "Never"}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
