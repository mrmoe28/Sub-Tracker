"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CreateLinkTokenResponse {
  link_token?: string;
  error?: string;
}

interface ExchangeResponse {
  itemId?: string;
  institutionName?: string | null;
  accountCount?: number;
  error?: string;
}

export function ConnectBankButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a fresh link_token from the server. We do this lazily on click
  // so we don't burn tokens when the dashboard mounts.
  const fetchLinkToken = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/plaid/create-link-token", {
        method: "POST",
      });
      const data = (await res.json()) as CreateLinkTokenResponse;
      if (!res.ok || !data.link_token) {
        throw new Error(data.error ?? "Failed to create link token");
      }
      setLinkToken(data.link_token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            public_token: publicToken,
            institution: metadata.institution,
          }),
        });
        const data = (await res.json()) as ExchangeResponse;
        if (!res.ok) {
          throw new Error(data.error ?? "Token exchange failed");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
        setLinkToken(null);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      setLoading(false);
      setLinkToken(null);
    },
  });

  // Auto-open Plaid Link as soon as the SDK is ready with our token.
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={fetchLinkToken} disabled={loading}>
        {loading ? (
          <Loader2 className="animate-spin" />
        ) : (
          <Plus />
        )}
        Connect bank
      </Button>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
