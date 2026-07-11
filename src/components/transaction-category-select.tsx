"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface CategoryOption {
  id: string;
  name: string;
  group: string | null;
}

interface Suggestion {
  id: string;
  name: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

interface Props {
  transactionId: string;
  value: string | null;
  categories: CategoryOption[];
  suggestion?: Suggestion | null;
}

interface CategorizeResponse {
  error?: string;
}

export function TransactionCategorySelect({
  transactionId,
  value,
  categories,
  suggestion,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onChange(nextValue: string) {
    setSelected(nextValue);
    setError(null);

    const res = await fetch(`/api/transactions/${transactionId}/categorize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: nextValue || null }),
    });
    const data = (await res.json()) as CategorizeResponse;
    if (!res.ok) {
      setError(data.error ?? "Failed");
      setSelected(value ?? "");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-1">
      <select
        value={selected}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs shadow-sm outline-none focus:border-ring"
      >
        <option value="">Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.group ? `${category.group}: ` : ""}
            {category.name}
          </option>
        ))}
      </select>
      {!selected && suggestion ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            Suggested: {suggestion.name}
          </span>
          {suggestion.confidence === "LOW" ? (
            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-900 dark:bg-yellow-500/15 dark:text-yellow-300">
              needs review
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => onChange(suggestion.id)}
            disabled={pending}
            className="rounded-md border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
