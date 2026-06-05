import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hashInviteToken } from "@/lib/invite-token";
import { prisma } from "@/lib/prisma";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!token || token.length < 16) {
    return <InviteScreen status="not-found" />;
  }

  const tokenHash = hashInviteToken(token);
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });

  if (!invite) {
    return <InviteScreen status="not-found" />;
  }

  if (invite.revokedAt) {
    return <InviteScreen status="revoked" email={invite.email} />;
  }

  if (invite.expiresAt < new Date()) {
    return <InviteScreen status="expired" email={invite.email} />;
  }

  // If a User already exists for this email, just point them at sign-in.
  const user = await prisma.user.findUnique({
    where: { email: invite.email.toLowerCase() },
  });
  if (user) {
    return <InviteScreen status="already-member" email={invite.email} />;
  }

  // Valid — record the intended email so the landing page can show a banner.
  const dest = `/?invite_email=${encodeURIComponent(invite.email)}`;
  redirect(dest);
}

function InviteScreen({
  status,
  email,
}: {
  status: "valid" | "not-found" | "revoked" | "expired" | "already-member";
  email?: string;
}) {
  const content = (() => {
    switch (status) {
      case "not-found":
        return {
          title: "Invite link not found",
          body: "This invite link is invalid or has already been used. Ask the person who invited you to send a new one.",
        };
      case "revoked":
        return {
          title: "Invite revoked",
          body: email
            ? `The invite for ${email} was revoked. Ask the person who invited you to send a new one.`
            : "This invite was revoked. Ask the person who invited you to send a new one.",
        };
      case "expired":
        return {
          title: "Invite expired",
          body: email
            ? `The invite for ${email} expired. Ask the person who invited you to send a new one.`
            : "This invite expired. Ask the person who invited you to send a new one.",
        };
      case "already-member":
        return {
          title: "You're already a member",
          body: email
            ? `${email} already has a Sub-Tracker account. Just sign in.`
            : "You already have a Sub-Tracker account. Just sign in.",
        };
      default:
        return { title: "", body: "" };
    }
  })();

  const showSignIn =
    status === "already-member" || status === "not-found" || status === "expired" || status === "revoked";

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{content.title}</CardTitle>
          <CardDescription>{content.body}</CardDescription>
        </CardHeader>
        <CardContent>
          {showSignIn ? (
            <Button asChild className="w-full">
              <Link href="/">Go to sign in</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
