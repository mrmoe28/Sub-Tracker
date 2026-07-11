import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { getPlaidClient } from "@/lib/plaid";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";
import { encryptToken } from "@/lib/token-encryption";

export const runtime = "nodejs";

interface Body {
  public_token?: string;
  institution?: { institution_id?: string; name?: string } | null;
}

export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const publicToken = body.public_token;
    if (!publicToken) {
      return NextResponse.json(
        { error: "public_token is required" },
        { status: 400 },
      );
    }

    const user = await getCurrentUser();
    const plaid = getPlaidClient();

    // 1. Exchange the short-lived public_token for a permanent access_token.
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    // 2. Encrypt the access_token before it ever touches the DB.
    const enc = encryptToken(accessToken);

    // 3. Fetch accounts in the same request so we can persist them atomically.
    const accountsResp = await plaid.accountsGet({ access_token: accessToken });
    const accounts = accountsResp.data.accounts;
    const institution = body.institution ?? null;

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.plaidItem.upsert({
        where: { plaidItemId: itemId },
        update: {
          accessTokenCiphertext: enc.ciphertext,
          accessTokenIv: enc.iv,
          accessTokenAuthTag: enc.authTag,
          encryptionKeyVersion: enc.keyVersion,
          institutionId: institution?.institution_id ?? undefined,
          institutionName: institution?.name ?? undefined,
          status: "ACTIVE",
        },
        create: {
          userId: user.id,
          plaidItemId: itemId,
          accessTokenCiphertext: enc.ciphertext,
          accessTokenIv: enc.iv,
          accessTokenAuthTag: enc.authTag,
          encryptionKeyVersion: enc.keyVersion,
          institutionId: institution?.institution_id,
          institutionName: institution?.name,
        },
      });

      for (const a of accounts) {
        await tx.plaidAccount.upsert({
          where: { plaidAccountId: a.account_id },
          update: {
            name: a.name,
            officialName: a.official_name ?? null,
            mask: a.mask ?? null,
            type: a.type ?? null,
            subtype: a.subtype ?? null,
            currency: a.balances?.iso_currency_code ?? null,
            currentBalance:
              a.balances?.current != null
                ? a.balances.current.toString()
                : null,
            availableBalance:
              a.balances?.available != null
                ? a.balances.available.toString()
                : null,
          },
          create: {
            userId: user.id,
            plaidItemId: created.id,
            plaidAccountId: a.account_id,
            name: a.name,
            officialName: a.official_name ?? null,
            mask: a.mask ?? null,
            type: a.type ?? null,
            subtype: a.subtype ?? null,
            currency: a.balances?.iso_currency_code ?? null,
            currentBalance:
              a.balances?.current != null
                ? a.balances.current.toString()
                : null,
            availableBalance:
              a.balances?.available != null
                ? a.balances.available.toString()
                : null,
          },
        });
      }

      return created;
    }, {
      // Prisma's default interactive-transaction timeout is 5s. Exchanging a
      // token plus upserting the item and every account against a
      // higher-latency production DB can exceed that (observed ~7.7s), which
      // expires the transaction mid-loop and 500s the connect flow. Give it
      // more headroom.
      timeout: 20000,
      maxWait: 10000,
    });

    return NextResponse.json({
      itemId: item.id,
      institutionName: item.institutionName,
      accountCount: accounts.length,
    });
  } catch (err) {
    safeLogError("plaid/exchange-public-token", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
