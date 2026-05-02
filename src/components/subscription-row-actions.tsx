"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Action = "confirm" | "ignore" | "cancel";

interface Props {
  candidateId: string;
  hasCancelUrl?: boolean;
  pendingCancellationCandidateId?: string | null;
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
}

export function SubscriptionRowActions({
  candidateId,
  hasCancelUrl,
  pendingCancellationCandidateId,
  status,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await fetch(
        `/api/subscriptions/${candidateId}/find-cancellation`,
        { method: "POST" },
      );
      const data = (await res.json()) as ActionResponse;
      if (!res.ok) throw new Error(data.error ?? "Search failed");
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
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
