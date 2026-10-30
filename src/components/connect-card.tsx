"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SavedSession {
  domain: string;
  cookieCount: number;
  capturedAt: string;
  lastUseOk: boolean | null;
}

interface Props {
  sessions: SavedSession[];
  hasToken: boolean;
}

// Settings card: pair the Chrome extension (so the hunt runs as the user's
// own signed-in session) and import a Chrome/Google password CSV.
export function ConnectCard({ sessions, hasToken }: Props) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  async function issueToken() {
    setBusy("token");
    setError(null);
    try {
      const res = await fetch("/api/connect/token", { method: "POST" });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Could not create token");
      setToken(data.token);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create token");
    } finally {
      setBusy(null);
    }
  }

  async function importPasswords(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/passwords/import", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: text,
      });
      const data = (await res.json()) as {
        matched?: number;
        unmatched?: number;
        merchants?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setNotice(
        `Saved logins for ${data.matched ?? 0} merchant${data.matched === 1 ? "" : "s"}` +
          (data.merchants?.length ? ` (${data.merchants.join(", ")})` : "") +
          `; ${data.unmatched ?? 0} rows didn't match a subscription.`,
      );
      setFile(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2">
        <h3 className="font-medium">1. Chrome extension (recommended)</h3>
        <p className="text-muted-foreground">
          Sends the cookies from a site you&apos;re already signed in to, so the finder
          runs as you — Google sign-in and 2FA already done in your own browser.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>
            <a className="underline" href="/sub-tracker-connect.zip">
              Download the extension
            </a>{" "}
            and unzip it.
          </li>
          <li>
            Open <code>chrome://extensions</code>, turn on Developer mode, click
            &quot;Load unpacked&quot; and pick the unzipped folder.
          </li>
          <li>Version 0.2 connects automatically when you use Cancel for me in this Chrome profile. No pairing token is needed for that workflow.</li>
          <li>
            Leave your signed-in merchant tab open. Cancel for me checks matching Chrome tabs before asking for a login. The popup below is a legacy manual fallback.
          </li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={issueToken} disabled={busy === "token"}>
            {busy === "token"
              ? "Creating…"
              : hasToken || token
                ? "Generate new pairing token"
                : "Generate pairing token"}
          </Button>
          {hasToken && !token ? (
            <span className="text-xs text-muted-foreground">
              A token is active. Generating a new one revokes it.
            </span>
          ) : null}
        </div>
        {token ? (
          <div className="space-y-1 rounded-md border bg-muted/30 p-2">
            <p className="text-xs text-muted-foreground">
              Copy this now — it&apos;s shown once.
            </p>
            <Input readOnly value={token} onFocus={(e) => e.currentTarget.select()} />
          </div>
        ) : null}
        <div>
          <h4 className="mt-3 text-xs font-medium uppercase text-muted-foreground">
            Saved sessions
          </h4>
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">None yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {sessions.map((s) => (
                <li
                  key={s.domain}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5"
                >
                  <span>{s.domain}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.cookieCount} cookies · {new Date(s.capturedAt).toLocaleString()}
                    {s.lastUseOk === false ? " · expired" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">2. Import saved passwords (fallback)</h3>
        <p className="text-muted-foreground">
          Export from Chrome (Settings → Passwords → ⋮ → Export) or Google Password
          Manager and upload the CSV. Only rows matching one of your subscriptions are
          kept, encrypted; the rest are discarded. Sites that use Google sign-in or
          captchas still need the extension.
        </p>
        <form onSubmit={importPasswords} className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept=".csv,text/csv"
            className="max-w-xs"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button size="sm" type="submit" disabled={!file || busy === "import"}>
            {busy === "import" ? "Importing…" : "Import"}
          </Button>
        </form>
      </section>

      {notice ? <p className="text-emerald-700">{notice}</p> : null}
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}
