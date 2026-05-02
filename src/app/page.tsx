import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LandingPage() {
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
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
            />
          </div>
          <Button asChild className="w-full">
            <Link href="/dashboard">Continue</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Auth is not wired up yet — this is a placeholder.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
