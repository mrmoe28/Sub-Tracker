import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignInWithGoogleButton } from "@/components/auth-actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SearchParams = Promise<{ invite_email?: string | string[] }>;

export default async function LandingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (session) redirect("/dashboard");

  const params = await searchParams;
  const rawInvite = Array.isArray(params.invite_email)
    ? params.invite_email[0]
    : params.invite_email;
  const inviteEmail = rawInvite?.trim();

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-lg">Sign in to Sub-Tracker</CardTitle>
          <CardDescription>
            Track your subscriptions and recurring spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {inviteEmail ? (
            <div className="rounded-md border border-brand/30 bg-brand-soft px-3 py-2 text-xs text-foreground">
              You were invited to Sub-Tracker as{" "}
              <span className="font-medium">{inviteEmail}</span>. Sign in with
              that Google account to accept the invite.
            </div>
          ) : null}
          <SignInWithGoogleButton />
          <p className="text-center text-xs text-muted-foreground">
            Use the Google account you want associated with your bank data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
