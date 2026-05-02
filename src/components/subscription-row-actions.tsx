"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type Action = "confirm" | "ignore" | "cancel";

interface Props {
  candidateId: string;
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

export function SubscriptionRowActions({ candidateId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === "CONFIRMED"}
          onClick={() => decide("confirm")}
          title="Confirm — this is a real subscription"
        >
          <Check className="h-3.5 w-3.5" />
          Confirm
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === "DISMISSED"}
          onClick={() => decide("ignore")}
          title="Ignore — not a subscription"
        >
          <X className="h-3.5 w-3.5" />
          Ignore
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || status === "ARCHIVED"}
          onClick={() => decide("cancel")}
          title="Mark canceled — subscription ended"
        >
          <CircleSlash className="h-3.5 w-3.5" />
          Canceled
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
