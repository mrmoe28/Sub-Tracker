"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Check,
  CircleSlash,
  KeyRound,
  LogIn,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Action = "confirm" | "ignore" | "cancel";

export type CancelAttemptStatus =
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "NEEDS_CODE"
  | "CANCELED"
  | "FAILED"
  | "ABORTED";

export interface CancelAttemptSummary {
  id: string;
  status: CancelAttemptStatus;
  note: string | null;
  url: string | null;
  pendingControlText: string | null;
  confirmationText: string | null;
  hasApprovalScreenshot: boolean;
  hasProofScreenshot: boolean;
}

interface Props {
  candidateId: string;
  hasCancelUrl?: boolean;
  pendingCancellationCandidateId?: string | null;
  // Stored merchant login for this user, if any.
  loginUsername?: string | null;
  // A live browser session sent from Chrome for this merchant's domain.
  hasSession?: boolean;
  lastLoginStatus?: string | null;
  lastLoginNote?: string | null;
  // Most recent Cancel-for-me run for this subscription, if any.
  latestCancelAttempt?: CancelAttemptSummary | null;
  status:
    | "PENDING_REVIEW"
    | "CONFIRMED"
    | "DISMISSED"
    | "ARCHIVED"
    | "LAPSED";
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
  hasSession,
  lastLoginStatus,
  lastLoginNote,
  latestCancelAttempt,
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
  const [attempt, setAttempt] = useState<CancelAttemptSummary | null>(
    latestCancelAttempt ?? null,
  );
  const [code, setCode] = useState("");
  const attemptId = attempt?.id;
  const attemptStatus = attempt?.status;
  useEffect(() => {
    if (!attemptId || !attemptStatus || !["RUNNING", "AWAITING_APPROVAL", "NEEDS_CODE"].includes(attemptStatus)) return;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/cancel-attempts/${attemptId}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (response.ok) setAttempt(await response.json());
      } catch {}
    }, 3000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [attemptId, attemptStatus]);
  const hasLogin = Boolean(loginUsername);
  const canHunt = hasLogin || Boolean(hasSession);
  const attemptActive =
    attempt?.status === "RUNNING" ||
    attempt?.status === "AWAITING_APPROVAL" ||
    attempt?.status === "NEEDS_CODE";

  async function postAttempt(
    url: string,
    key: string,
    body?: Record<string, unknown>,
    busyNotice?: string,
  ) {
    setLoading(key);
    setError(null);
    setNotice(busyNotice ?? null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as CancelAttemptSummary & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Cancel attempt failed");
      setAttempt(data);
      setNotice(null);
      if (data.status === "CANCELED") {
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setNotice(null);
      setError(e instanceof Error ? e.message : "Cancel attempt failed");
    } finally {
      setLoading(null);
    }
  }

  function cancelForMe() {
    return postAttempt(
      `/api/subscriptions/${candidateId}/cancel`,
      "cancel",
      undefined,
      "Signing in and walking to the cancel button (up to ~90s)…",
    );
  }

  function approveAttempt() {
    if (!attempt) return;
    return postAttempt(
      `/api/cancel-attempts/${attempt.id}/approve`,
      "cancel-approve",
      undefined,
      "Clicking cancel and waiting for the confirmation…",
    );
  }

  function abortAttempt() {
    if (!attempt) return;
    return postAttempt(`/api/cancel-attempts/${attempt.id}/abort`, "cancel-abort");
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!attempt || !code.trim()) return;
    const value = code.trim();
    setCode("");
    return postAttempt(
      `/api/cancel-attempts/${attempt.id}/code`,
      "cancel-code",
      { code: value },
      "Entering the code and continuing…",
    );
  }

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
        {canHunt ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || Boolean(loading)}
            onClick={loginAndFind}
            title={
              hasSession
                ? "Use your saved browser session and locate the cancel page"
                : `Sign in as ${loginUsername} and locate the cancel page`
            }
          >
            <LogIn className="h-3.5 w-3.5" />
            {loading === "hunt" ? "Signing in…" : hasSession ? "Find as me" : "Log in & find"}
          </Button>
        ) : null}
        {canHunt && status !== "ARCHIVED" && !attemptActive ? (
          <Button
            size="sm"
            disabled={pending || Boolean(loading)}
            onClick={cancelForMe}
            title="Sign in, walk to the cancel button, and stop for your approval before anything irreversible"
          >
            <Bot className="h-3.5 w-3.5" />
            {loading === "cancel" ? "Working…" : "Cancel for me"}
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
            asks for approval before clicking a cancellation control.
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
      {attempt ? (
        <div className="mt-1 flex w-72 flex-col gap-1.5 rounded-md border bg-muted/30 p-2 text-left">
          {attempt.status === "AWAITING_APPROVAL" ? (
            <>
              {attempt.hasApprovalScreenshot ? (
                <a
                  href={`/api/cancel-attempts/${attempt.id}/screenshot?kind=approval`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the full screenshot"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/cancel-attempts/${attempt.id}/screenshot?kind=approval`}
                    alt="Page where the cancel button was found"
                    className="w-full rounded border"
                  />
                </a>
              ) : null}
              <p className="text-[11px] leading-snug text-muted-foreground">
                {attempt.note ??
                  `Ready to click "${attempt.pendingControlText ?? "Cancel"}". Nothing has been canceled yet.`}
              </p>
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(loading)}
                  onClick={abortAttempt}
                >
                  Stop
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={Boolean(loading)}
                  onClick={approveAttempt}
                >
                  {loading === "cancel-approve"
                    ? "Canceling…"
                    : `Approve: ${attempt.pendingControlText ?? "Cancel"}`}
                </Button>
              </div>
            </>
          ) : null}
          {attempt.status === "NEEDS_CODE" ? (
            <form onSubmit={submitCode} className="flex flex-col gap-1.5">
              <p className="text-[11px] leading-snug text-muted-foreground">
                {attempt.note ?? "The site sent you a verification code. Enter it to continue."}
              </p>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Verification code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(loading)}
                  onClick={abortAttempt}
                >
                  Stop
                </Button>
                <Button type="submit" size="sm" disabled={Boolean(loading)}>
                  {loading === "cancel-code" ? "Continuing…" : "Continue"}
                </Button>
              </div>
            </form>
          ) : null}
          {attempt.status === "RUNNING" ? (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {attempt.note ?? "Working on it…"}
            </p>
          ) : null}
          {attempt.status === "CANCELED" ? (
            <>
              <p className="text-[11px] font-medium leading-snug text-emerald-700 dark:text-emerald-300">
                Canceled. {attempt.confirmationText ? `"${attempt.confirmationText}"` : null}
              </p>
              {attempt.hasProofScreenshot ? (
                <a
                  href={`/api/cancel-attempts/${attempt.id}/screenshot?kind=proof`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] underline"
                >
                  View proof screenshot
                </a>
              ) : null}
            </>
          ) : null}
          {attempt.status === "FAILED" || attempt.status === "ABORTED" ? (
            <>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {attempt.note ?? (attempt.status === "ABORTED" ? "Stopped." : "Didn't finish.")}
              </p>
              {attempt.status === "FAILED" &&
              (attempt.hasApprovalScreenshot || attempt.hasProofScreenshot) ? (
                <a
                  href={`/api/cancel-attempts/${attempt.id}/screenshot?kind=${attempt.hasProofScreenshot ? "proof" : "approval"}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] underline"
                >
                  View last screenshot
                </a>
              ) : null}
              {attempt.url ? (
                <a
                  href={attempt.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-[11px] underline"
                  title={attempt.url}
                >
                  Open where it stopped
                </a>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
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
