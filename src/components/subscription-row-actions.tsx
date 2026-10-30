"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, KeyRound, LogIn, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Action = "confirm" | "ignore" | "cancel";

interface Props {
  candidateId: string;
  hasCancelUrl?: boolean;
  pendingCancellationCandidateId?: string | null;
  // Stored merchant login for this user, if any.
  loginUsername?: string | null;
  lastLoginStatus?: string | null;
  lastLoginNote?: string | null;
  status:
    | "PENDING_REVIEW"
    | "CONFIRMED"
    | "DISMISSED"
    | "ARCHIVED";
}

interface DecideResponse {
  status?: string;
  error?: string;
}

interface ActionResponse {
  error?: string;
  message?: string;
  created?: number;
}

interface HuntResponse {
  error?: string;
  status?: string;
  url?: string | null;
  message?: string;
}

export function SubscriptionRowActions({
  candidateId,
  hasCancelUrl,
  pendingCancellationCandidateId,
  loginUsername,
  lastLoginStatus,
  lastLoginNote,
  status,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [username, setUsername] = useState(loginUsername ?? "");
  const [password, setPassword] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const hasLogin = Boolean(loginUsername);

  async function decide(action: Action) {
    setError(null);
    const res = await fetch(`/api/subscriptions/${candidateId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json()) as DecideResponse;
    if (!res.ok) {
      setError(data.error ?? "Failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function findCancellation() {
    setLoading("find");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/subscriptions/${candidateId}/find-cancellation`,
        { method: "POST" },
      );
      const data = (await res.json()) as ActionResponse;
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setNotice(
        data.message ?? (data.created ? null : "Nothing usable found."),
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(null);
    }
  }

  async function approveCancellationCandidate() {
    if (!pendingCancellationCandidateId) return;
    setLoading("approve");
    setError(null);
    try {
      const res = await fetch(
        `/api/cancellation-candidates/${pendingCancellationCandidateId}/approve`,
        { method: "POST" },
      );
      const data = (await res.json()) as ActionResponse;
      if (!res.ok) throw new Error(data.error ?? "Approval failed");
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setLoading(null);
    }
  }

  async function loginAndFind() {
    setLoading("hunt");
    setError(null);
    setNotice("Signing in and looking for the cancel page (up to ~90s)…");
    try {
      const res = await fetch(
        `/api/subscriptions/${candidateId}/login-and-find`,
        { method: "POST" },
      );
      const data = (await res.json()) as HuntResponse;
      if (!res.ok) throw new Error(data.error ?? "Login attempt failed");
      setNotice(data.message ?? null);
      startTransition(() => router.refresh());
    } catch (e) {
      setNotice(null);
      setError(e instanceof Error ? e.message : "Login attempt failed");
    } finally {
      setLoading(null);
    }
  }

  async function saveLogin(e: FormEvent) {
    e.preventDefault();
    setLoading("save");
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${candidateId}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, loginUrl }),
      });
      const data = (await res.json()) as ActionResponse;
      if (!res.ok) throw new Error(data.error ?? "Could not save login");
      setPassword("");
      setShowLogin(false);
      await loginAndFind();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save login");
    } finally {
      setLoading(null);
    }
  }

  async function removeLogin() {
    setLoading("remove");
    setError(null);
    try {
      const res = await fetch(`/api/subscriptions/${candidateId}/login`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not remove login");
      setUsername("");
      setShowLogin(false);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove login");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {pendingCancellationCandidateId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || loading === "approve"}
            onClick={approveCancellationCandidate}
            title="Approve the suggested cancellation link"
          >
            <Check className="h-3.5 w-3.5" />
            Approve link
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || Boolean(loading) || hasCancelUrl}
            onClick={findCancellation}
            title={
              hasCancelUrl
                ? "A cancellation link is already available"
                : "Search for cancellation info"
            }
          >
            <Search className="h-3.5 w-3.5" />
            Find link
          </Button>
        )}
        {hasLogin ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || Boolean(loading)}
            onClick={loginAndFind}
            title={`Sign in as ${loginUsername} and locate the cancel page`}
          >
            <LogIn className="h-3.5 w-3.5" />
            {loading === "hunt" ? "Signing in…" : "Log in & find"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={pending || Boolean(loading)}
          onClick={() => setShowLogin((v) => !v)}
          title={
            hasLogin
              ? "Update or remove the saved login for this merchant"
              : "Save your login so the app can sign in and find the cancel page"
          }
        >
          <KeyRound className="h-3.5 w-3.5" />
          {hasLogin ? "Login saved" : "Add login"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === "CONFIRMED"}
          onClick={() => decide("confirm")}
          title="Confirm this is a real subscription"
        >
          <Check className="h-3.5 w-3.5" />
          Confirm
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === "DISMISSED"}
          onClick={() => decide("ignore")}
          title="Ignore this subscription"
        >
          <X className="h-3.5 w-3.5" />
          Ignore
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === "ARCHIVED"}
          onClick={() => decide("cancel")}
          title="Mark this subscription canceled"
        >
          <CircleSlash className="h-3.5 w-3.5" />
          Canceled
        </Button>
      </div>
      {showLogin ? (
        <form
          onSubmit={saveLogin}
          className="mt-1 flex w-72 flex-col gap-1.5 rounded-md border bg-muted/30 p-2 text-left"
        >
          <Input
            type="text"
            autoComplete="off"
            placeholder="Email or username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={hasLogin ? "New password" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            type="url"
            autoComplete="off"
            placeholder="Login page URL (optional)"
            value={loginUrl}
            onChange={(e) => setLoginUrl(e.target.value)}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Stored encrypted. The app signs in, finds the cancel page, and
            stops there — it never clicks cancel for you.
          </p>
          <div className="flex justify-end gap-1">
            {hasLogin ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={Boolean(loading)}
                onClick={removeLogin}
              >
                Remove
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowLogin(false)}
            >
              Close
            </Button>
            <Button type="submit" size="sm" disabled={Boolean(loading)}>
              {loading === "save" ? "Saving…" : "Save & find"}
            </Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {notice ? (
        <p className="max-w-[36ch] text-right text-xs text-muted-foreground">
          {notice}
        </p>
      ) : lastLoginNote && lastLoginStatus ? (
        <p
          className="max-w-[36ch] text-right text-xs text-muted-foreground"
          title={`Last automated attempt: ${lastLoginStatus}`}
        >
          {lastLoginNote}
        </p>
      ) : null}
    </div>
  );
}
