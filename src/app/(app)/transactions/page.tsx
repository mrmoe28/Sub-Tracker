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

export default async function TransactionsPage() {
  const user = await getCurrentUser();

  // SECURITY: `Transaction.raw` stores the full Plaid response object,
  // which includes location, payment_meta, and other PII. Use an explicit
  // `select` so the page never loads it into RSC scope.
  const [transactions, categories, hasAnyItems] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id },
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
    prisma.transactionCategory.findMany({
      where: { OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, name: true, group: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.plaidItem
      .count({ where: { userId: user.id } })
      .then((n) => n > 0),
  ]);

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
          <CardTitle>
            {transactions.length === 0 ? "No transactions" : "Recent activity"}
          </CardTitle>
          <CardDescription>
            {hasAnyItems
              ? "Click Sync to pull the latest from your linked accounts."
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
                      colSpan={6}
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
