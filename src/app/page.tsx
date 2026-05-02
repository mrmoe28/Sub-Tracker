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

export default async function LandingPage() {
  const session = await auth();
  if (session) redirect("/dashboard");

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
          <SignInWithGoogleButton />
          <p className="text-center text-xs text-muted-foreground">
            Use the Google account you want associated with your bank data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
