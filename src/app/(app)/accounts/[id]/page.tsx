import Link from "next/link";
import { notFound } from "next/navigation";

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

const PAGE_SIZE = 200;

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AccountPage({ params }: Props) {
  const user = await getCurrentUser();
  const { id } = await params;

  const account = await prisma.plaidAccount.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      name: true,
      officialName: true,
      mask: true,
      subtype: true,
      currency: true,
      currentBalance: true,
      availableBalance: true,
      plaidItem: { select: { institutionName: true } },
    },
  });
  if (!account) notFound();

  const [transactions, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId: user.id, accountId: account.id },
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
        suggestedCategoryId: true,
        suggestedCategoryName: true,
        suggestedConfidence: true,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
    }),
    prisma.transactionCategory.findMany({
      where: { OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true, name: true, group: true, color: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  const currency = account.currency ?? "USD";
  const spent = transactions
    .filter((txn) => !txn.pending && Number(txn.amount) > 0)
    .reduce((sum, txn) => sum + Number(txn.amount), 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/settings"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Accounts
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {account.name}
          {account.mask ? ` ····${account.mask}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {account.plaidItem.institutionName ?? "Institution"} /{" "}
          {account.subtype ?? "account"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Current balance</CardDescription>
            <CardTitle>
              {account.currentBalance != null
                ? formatCurrency(account.currentBalance.toString(), currency)
                : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Available</CardDescription>
            <CardTitle>
              {account.availableBalance != null
                ? formatCurrency(account.availableBalance.toString(), currency)
                : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Spent (posted, shown)</CardDescription>
            <CardTitle>{formatCurrency(spent.toString(), currency)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transactions</CardTitle>
          <CardDescription>
            Only this account. Showing the most recent {PAGE_SIZE}.
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
                  <th className="px-4 py-2 text-left font-medium">Category</th>
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
                      No transactions for this account yet. Sync from
                      Transactions.
                    </td>
                  </tr>
                ) : (
                  transactions.map((txn) => (
                    <tr key={txn.id} className="border-t">
                      <td className="px-4 py-2 text-muted-foreground">
                        {txn.date.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-2">{txn.merchantName ?? "—"}</td>
                      <td
                        className="max-w-[24ch] truncate px-4 py-2 text-muted-foreground"
                        title={txn.name}
                      >
                        {txn.name}
                      </td>
                      <td className="px-4 py-2">
                        <TransactionCategorySelect
                          transactionId={txn.id}
                          value={txn.userCategoryId}
                          categories={categories}
                          suggestion={
                            txn.userCategoryId == null &&
                            txn.suggestedCategoryId
                              ? {
                                  id: txn.suggestedCategoryId,
                                  name: txn.suggestedCategoryName ?? "",
                                  confidence:
                                    (txn.suggestedConfidence as
                                      | "HIGH"
                                      | "MEDIUM"
                                      | "LOW") ?? "LOW",
                                }
                              : null
                          }
                        />
                      </td>
                      <td className="px-4 py-2">
                        {txn.pending ? "Pending" : "Posted"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {formatCurrency(
                          txn.amount.toString(),
                          txn.isoCurrencyCode ?? "USD",
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
