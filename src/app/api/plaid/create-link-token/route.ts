import { NextResponse, type NextRequest } from "next/server";
import { CountryCode, Products } from "plaid";

import { getCurrentUser } from "@/lib/current-user";
import { getServerEnv } from "@/lib/env";
import { requireSameOrigin } from "@/lib/origin-check";
import { getPlaidClient } from "@/lib/plaid";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const env = getServerEnv();
    const user = await getCurrentUser();
    const plaid = getPlaidClient();

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Sub-Tracker",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      redirect_uri: env.plaidRedirectUri,
      webhook: env.plaidWebhookUrl || undefined,
      // Ask Plaid for the maximum transaction history (2 years). Recurring /
      // subscription detection needs enough history to see a cadence — the
      // default (~90 days) misses most subscriptions and all annual ones.
      // NOTE: this only applies at link time, so existing items must be
      // reconnected to backfill the full window.
      transactions: { days_requested: 730 },
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (err) {
    safeLogError("plaid/create-link-token", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
