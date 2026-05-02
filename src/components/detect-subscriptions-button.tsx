"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface DetectResponse {
  plaid?: {
    items: number;
    streamsUpserted: number;
    candidatesUpserted: number;
    candidatesSkipped: number;
  };
  heuristic?: {
    evaluated: number;
    candidatesUpserted: number;
  };
  error?: string;
}

interface Props {
  disabled?: boolean;
}

export function DetectSubscriptionsButton({ disabled }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/subscriptions/detect", { method: "POST" });
      const data = (await res.json()) as DetectResponse;
      if (!res.ok) throw new Error(data.error ?? "Detection failed");
      const plaid = data.plaid;
      const heuristic = data.heuristic;
      const fromPlaid = plaid?.candidatesUpserted ?? 0;
      const fromHeuristic = heuristic?.candidatesUpserted ?? 0;
      setMessage(
        `Plaid streams: ${plaid?.streamsUpserted ?? 0}, ` +
          `Plaid candidates: ${fromPlaid}, ` +
          `heuristic candidates: ${fromHeuristic}.`,
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={onClick} disabled={disabled || loading}>
        {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Detect subscriptions
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
