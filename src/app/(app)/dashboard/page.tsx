import { Building2 } from "lucide-react";

import { ConnectBankButton } from "@/components/connect-bank-button";
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

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // SECURITY: explicit `select` so the access-token ciphertext, IV, auth
  // tag, key version, and the transactions cursor are never loaded into
  // a server component's scope (and therefore can't accidentally leak via
  // the RSC payload if a future client component receives this data).
  const items = await prisma.plaidItem.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      institutionName: true,
      status: true,
      lastSyncedAt: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          name: true,
          mask: true,
          type: true,
          subtype: true,
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const accountCount = items.reduce((n, i) => n + i.accounts.length, 0);
  const txnCount = await prisma.transaction.count({
    where: { userId: user.id },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            A quick look at your subscriptions and recent activity.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <ConnectBankButton />
          <SyncTransactionsButton disabled={items.length === 0} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Linked institutions</CardDescription>
            <CardTitle className="text-2xl">{items.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Linked accounts</CardDescription>
            <CardTitle className="text-2xl">{accountCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Imported transactions</CardDescription>
            <CardTitle className="text-2xl">{txnCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last sync</CardDescription>
            <CardTitle className="text-2xl">
              {items[0]?.lastSyncedAt
                ? items[0].lastSyncedAt.toLocaleString()
                : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected institutions</CardTitle>
          <CardDescription>
            Plaid Sandbox environment. Connect more banks above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No banks connected yet. Click &ldquo;Connect bank&rdquo; to get
              started.
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="text-sm font-medium">
                          {item.institutionName ?? "Unknown institution"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.accounts.length} account
                          {item.accounts.length === 1 ? "" : "s"} ·{" "}
                          {item.status.replace(/_/g, " ").toLowerCase()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {item.lastSyncedAt
                        ? `Synced ${item.lastSyncedAt.toLocaleString()}`
                        : "Never synced"}
                    </div>
                  </div>
                  {item.accounts.length > 0 ? (
                    <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      {item.accounts.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center justify-between rounded-sm bg-muted/40 px-2 py-1"
                        >
                          <span className="truncate">
                            {a.name}
                            {a.mask ? ` ····${a.mask}` : ""}
                          </span>
                          <span className="ml-2 shrink-0 uppercase tracking-wide">
                            {a.subtype ?? a.type ?? ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
