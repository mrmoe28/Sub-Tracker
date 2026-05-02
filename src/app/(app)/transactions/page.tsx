import Link from "next/link";

import { SyncTransactionsButton } from "@/components/sync-transactions-button";
import { TransactionCategorySelect } from "@/components/transaction-category-select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const UNCATEGORIZED = "uncategorized";

interface Props {
  searchParams?: Promise<{ categoryId?: string }>;
}

function categoryHref(categoryId: string | null): string {
  if (!categoryId) return "/transactions";
  return `/transactions?categoryId=${encodeURIComponent(categoryId)}`;
}

export default async function TransactionsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const activeCategoryId = params?.categoryId ?? null;
  const categoryFilter =
    activeCategoryId === UNCATEGORIZED
      ? { userCategoryId: null }
      : activeCategoryId
        ? { userCategoryId: activeCategoryId }
        : {};

  // SECURITY: `Transaction.raw` stores the full Plaid response object,
  // which includes location, payment_meta, and other PII. Use an explicit
  // `select` so the page never loads it into RSC scope.
  const [transactions, summaryTransactions, categories, hasAnyItems] =
    await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id, ...categoryFilter },
      select: {
        id: true,
        date: true,
        name: true,
        merchantName: true,
        amount: true,
        isoCurrencyCode: true,
        pending: true,
        userCategoryId: true,
        userCategoryName: true,
        account: { select: { id: true, name: true, mask: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
    }),
    prisma.transaction.findMany({
      where: { userId: user.id, pending: false },
      select: {
        id: true,
        amount: true,
        isoCurrencyCode: true,
        userCategoryId: true,
        userCategoryName: true,
      },
    }),
    prisma.transactionCategory.findMany({
      where: { OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, name: true, group: true, color: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.plaidItem
      .count({ where: { userId: user.id } })
      .then((n) => n > 0),
  ]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const summary = new Map<
    string,
    {
      id: string | null;
      label: string;
      group: string | null;
      color: string | null;
      total: number;
      count: number;
      currency: string;
    }
  >();

  for (const txn of summaryTransactions) {
    const key = txn.userCategoryId ?? UNCATEGORIZED;
    const category = txn.userCategoryId
      ? categoryById.get(txn.userCategoryId)
      : null;
    const current =
      summary.get(key) ??
      {
        id: txn.userCategoryId,
        label: category?.name ?? txn.userCategoryName ?? "Uncategorized",
        group: category?.group ?? (txn.userCategoryId ? null : "Review"),
        color: category?.color ?? null,
        total: 0,
        count: 0,
        currency: txn.isoCurrencyCode ?? "USD",
      };
    current.total += Number(txn.amount);
    current.count += 1;
    summary.set(key, current);
  }

  const summaryRows = [...summary.values()].sort((a, b) => {
    if (a.id === null) return -1;
    if (b.id === null) return 1;
    return Math.abs(b.total) - Math.abs(a.total);
  });
  const activeCategory =
    activeCategoryId === UNCATEGORIZED
      ? { name: "Uncategorized" }
      : activeCategoryId
        ? categoryById.get(activeCategoryId)
        : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Transactions
          </h1>
          <p className="text-sm text-muted-foreground">
            Imported via Plaid /transactions/sync. Showing the most recent{" "}
            {PAGE_SIZE}.
          </p>
        </div>
        <SyncTransactionsButton disabled={!hasAnyItems} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Category summary</CardTitle>
              <CardDescription>
                Posted transaction totals grouped by your bookkeeping category.
              </CardDescription>
            </div>
            {activeCategory ? (
              <Link
                href="/transactions"
                className="rounded-md border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Clear filter
              </Link>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {summaryRows.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              No posted transactions to summarize yet.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryRows.map((row) => {
                const href = categoryHref(row.id ?? UNCATEGORIZED);
                const active =
                  activeCategoryId === (row.id ?? UNCATEGORIZED);
                return (
                  <Link
                    key={row.id ?? UNCATEGORIZED}
                    href={href}
                    className={`rounded-md border p-4 transition-colors hover:bg-muted/60 ${
                      active ? "border-foreground bg-muted/50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor: row.color ?? "#6b7280",
                            }}
                          />
                          <span className="truncate text-sm font-medium">
                            {row.label}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.group ?? "Category"} / {row.count} transaction
                          {row.count === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="text-right font-mono text-sm font-semibold tabular-nums">
                        {formatCurrency(row.total.toFixed(2), row.currency)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {transactions.length === 0
              ? "No transactions"
              : activeCategory
                ? `${activeCategory.name} transactions`
                : "Recent activity"}
          </CardTitle>
          <CardDescription>
            {hasAnyItems
              ? activeCategory
                ? `Showing up to ${PAGE_SIZE} transactions in this category.`
                : "Click Sync to pull the latest from your linked accounts."
              : "Connect a bank from the dashboard to start importing transactions."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Merchant</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Description
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Account</th>
                  <th className="px-4 py-2 text-left font-medium">
                    Category
                  </th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No data
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="px-4 py-2 text-muted-foreground">
                        {t.date.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-2">
                        {t.merchantName ?? "—"}
                      </td>
                      <td
                        className="max-w-[24ch] truncate px-4 py-2 text-muted-foreground"
                        title={t.name}
                      >
                        {t.name}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {t.account
                          ? `${t.account.name}${
                              t.account.mask ? ` ····${t.account.mask}` : ""
                            }`
                          : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <TransactionCategorySelect
                          transactionId={t.id}
                          value={t.userCategoryId}
                          categories={categories}
                        />
                        {t.userCategoryName ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Saved as {t.userCategoryName}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        {t.pending ? (
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-300">
                            Pending
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            Posted
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatCurrency(
                          t.amount.toString(),
                          t.isoCurrencyCode ?? "USD",
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
