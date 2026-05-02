"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SyncResponse {
  totals?: { added: number; modified: number; removed: number };
  error?: string;
}

interface Props {
  disabled?: boolean;
}

export function SyncTransactionsButton({ disabled }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/plaid/sync-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as SyncResponse;
      if (!res.ok) {
        throw new Error(data.error ?? "Sync failed");
      }
      const t = data.totals ?? { added: 0, modified: 0, removed: 0 };
      setMessage(
        `Added ${t.added}, modified ${t.modified}, removed ${t.removed}.`,
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
      <Button
        variant="outline"
        onClick={onClick}
        disabled={disabled || loading}
      >
        {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        Sync transactions
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
