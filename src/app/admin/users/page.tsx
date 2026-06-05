import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";

import { FormSubmitButton } from "./_components/form-submit-button";
import { InviteForm } from "./_components/invite-form";
import { ResendInviteButton } from "./_components/resend-invite-button";
import {
  changeRoleAction,
  revokeInviteAction,
} from "./_lib/actions";
import { initialActionState } from "./_lib/state";

type SearchParams = Promise<{ msg?: string }>;

function statusFor(invite: {
  revokedAt: Date | null;
  expiresAt: Date;
}): "active" | "revoked" | "expired" {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt < new Date()) return "expired";
  return "active";
}

// Plain-form wrappers around the (_prev, formData) signature used by
// useActionState. Drop the prev arg and discard the return value so the
// function matches `<form action={fn}>`'s `(formData) => Promise<void>`
// expectation.
const revokeInvite = async (formData: FormData) => {
  await revokeInviteAction(initialActionState, formData);
};
const changeRole = async (formData: FormData) => {
  await changeRoleAction(initialActionState, formData);
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  let me;
  try {
    me = await getCurrentUser();
  } catch {
    redirect("/");
  }

  if (me.role !== "OWNER" && me.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <h1 className="text-lg font-semibold">Not authorized</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You need admin access to manage users.
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const flash = params.msg;

  const [users, invites] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        role: true,
        createdAt: true,
      },
    }),
    prisma.invite.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        invitedBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage who can sign in to Sub-Tracker. Access is invite-only.
        </p>
      </div>

      {flash ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          {flash}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invite a new user</CardTitle>
          <CardDescription>
            We&apos;ll email them a one-time sign-in link valid for 7 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {users.length} {users.length === 1 ? "user" : "users"}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Email</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Joined</th>
                <th className="px-2 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isMe={u.id === me.id}
                  canChangeRole={me.role === "OWNER"}
                />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invites</CardTitle>
          <CardDescription>
            {invites.length} {invites.length === 1 ? "invite" : "invites"}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invites yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Email</th>
                  <th className="px-2 py-2 font-medium">Invited by</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Expires</th>
                  <th className="px-2 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const status = statusFor(inv);
                  return (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="px-2 py-2 font-medium">{inv.email}</td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {inv.invitedBy.name || inv.invitedBy.email}
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                            (status === "active"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : status === "revoked"
                              ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300")
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {inv.expiresAt.toLocaleDateString()}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-2">
                          {status === "active" ? (
                            <>
                              <ResendInviteButton inviteId={inv.id} />
                              <form action={revokeInvite} className="inline">
                                <input
                                  type="hidden"
                                  name="id"
                                  value={inv.id}
                                />
                                <FormSubmitButton
                                  variant="ghost"
                                  pendingLabel="Revoking…"
                                  idleLabel="Revoke"
                                />
                              </form>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({
  user,
  isMe,
  canChangeRole,
}: {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: "OWNER" | "ADMIN" | "MEMBER";
    createdAt: Date;
  };
  isMe: boolean;
  canChangeRole: boolean;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-2 py-2">
        {user.name || <span className="text-muted-foreground">—</span>}
        {isMe ? (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            (you)
          </span>
        ) : null}
      </td>
      <td className="px-2 py-2 text-muted-foreground">{user.email}</td>
      <td className="px-2 py-2">
        {canChangeRole && !isMe ? (
          <form action={changeRole} className="inline-flex items-center gap-1.5">
            <input type="hidden" name="id" value={user.id} />
            <select
              name="role"
              defaultValue={user.role}
              className="rounded border bg-background px-2 py-1 text-xs"
            >
              <option value="OWNER">OWNER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="MEMBER">MEMBER</option>
            </select>
            <FormSubmitButton
              variant="ghost"
              pendingLabel="Saving…"
              idleLabel="Save"
            />
          </form>
        ) : (
          <span className="inline-flex rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {user.role}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-xs text-muted-foreground">
        {user.createdAt.toLocaleDateString()}
      </td>
      <td className="px-2 py-2 text-right text-xs text-muted-foreground">
        {isMe ? "—" : ""}
      </td>
    </tr>
  );
}
