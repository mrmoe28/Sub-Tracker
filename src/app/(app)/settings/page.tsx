import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const accounts = await prisma.plaidAccount.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      mask: true,
      subtype: true,
      plaidItem: { select: { institutionName: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and connected accounts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear in Sub-Tracker.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:max-w-md">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={user.name ?? ""} readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={user.email ?? ""} readOnly />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked accounts</CardTitle>
          <CardDescription>
            Connect a bank to import transactions automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {accounts.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              No accounts linked. Connect a bank from the dashboard.
            </div>
          ) : (
            <ul className="space-y-2">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>
                    {account.name}
                    {account.mask ? ` ****${account.mask}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {account.plaidItem.institutionName ?? "Institution"} /{" "}
                    {account.subtype ?? "account"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
