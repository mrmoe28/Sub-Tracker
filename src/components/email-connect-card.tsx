"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function EmailConnectCard({ accounts, outcome }: { accounts: string[]; outcome?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/email/connect", { method: "POST" });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Email connection failed.");
      window.location.assign(result.url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Email connection failed.");
      setBusy(false);
    }
  }
  return <section className="space-y-3 rounded-lg border p-4 text-sm">
    <h2 className="font-semibold">Email receipt discovery</h2>
    <p>Connect each Gmail account once. Sub-Tracker searches receipt headers to help identify your subscription account. It cannot send or delete email.</p>
    {accounts.length ? <ul>{accounts.map((account) => <li key={account}>{account} — connected read-only</li>)}</ul> : <p>No email accounts connected.</p>}
    <Button onClick={connect} disabled={busy}>{busy ? "Opening Google…" : "Connect Gmail read-only"}</Button>
    {outcome === "failed" ? <p role="alert">Google connection did not finish. No new email connection was saved.</p> : null}
    {outcome === "connected" ? <p>Email connected.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
