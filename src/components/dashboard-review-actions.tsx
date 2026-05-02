"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  candidateId: string;
}

interface DecideResponse {
  status?: string;
  error?: string;
}

export function DashboardReviewActions({ candidateId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "confirm" | "ignore") {
    setError(null);
    const res = await fetch(`/api/subscriptions/${candidateId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json().catch(() => ({}))) as DecideResponse;
    if (!res.ok) {
      setError(data.error ?? "Failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-3 flex gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("ignore")}
        className="flex-1 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
      >
        Ignore
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => decide("confirm")}
        className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        Confirm
      </button>
      {error ? (
        <span className="ml-2 self-center text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
