"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SuggestResponse {
  updated?: number;
  error?: string;
}

interface Props {
  disabled?: boolean;
}

export function SuggestCategoriesButton({ disabled }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/transactions/suggest-categories", {
        method: "POST",
      });
      const data = (await res.json()) as SuggestResponse;
      if (!res.ok) throw new Error(data.error ?? "Suggestion failed");
      setMessage(`Suggested categories for ${data.updated ?? 0} transactions.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="outline" onClick={onClick} disabled={disabled || loading}>
        {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Suggest categories
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
