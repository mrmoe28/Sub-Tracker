"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CardRow {
  id: string;
  nickname: string;
  last4: string;
  issuer: string | null;
}

export function PaymentCardsCard({ cards }: { cards: CardRow[] }) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [last4, setLast4] = useState("");
  const [issuer, setIssuer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payment-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, last4, issuer }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save card");
      setNickname("");
      setLast4("");
      setIssuer("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetch(`/api/payment-cards?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {cards.length > 0 ? (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>
                {card.nickname} ····{card.last4}
                {card.issuer ? ` (${card.issuer})` : ""}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(card.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3 sm:max-w-md">
        <div className="space-y-1">
          <Label htmlFor="card-nickname">Nickname</Label>
          <Input id="card-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Business debit" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="card-last4">Last 4 digits</Label>
          <Input id="card-last4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} placeholder="1234" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="card-issuer">Bank (optional)</Label>
          <Input id="card-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" onClick={add} disabled={busy}>
          {busy ? "Saving..." : "Add card"}
        </Button>
      </div>
    </div>
  );
}
