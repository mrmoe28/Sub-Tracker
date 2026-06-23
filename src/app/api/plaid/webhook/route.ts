import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { syncPlaidItemTransactions } from "@/lib/plaid-sync";
import { syncRecurringStreams } from "@/lib/subscription-detection";
import { safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

// Minimal type for what we need out of a Plaid webhook body.
interface WebhookBody {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: {
    error_code?: string;
    error_message?: string;
  } | null;
}

/**
 * Public webhook endpoint called by Plaid.
 *
 * - Does NOT require same-origin or session auth (Plaid calls from its
 *   servers).
 * - Must return 200 within 10s or Plaid will retry.
 * - Actions taken here (sync, status updates) are idempotent by design.
 */
export async function POST(req: NextRequest) {
  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const webhookType = body.webhook_type ?? "";
  const webhookCode = body.webhook_code ?? "";
  const plaidItemId = body.item_id;

  if (!plaidItemId) {
    return NextResponse.json(
      { error: "missing_item_id" },
      { status: 400 },
    );
  }

  // Fire-and-forget the work so we can return 200 ASAP. Plaid retries on
  // non-200 or >10s; we MUST acknowledge quickly.
  void (async () => {
    try {
      await handleWebhook({ webhookType, webhookCode, plaidItemId, body });
    } catch (err) {
      safeLogError("plaid/webhook", err);
    }
  })();

  return NextResponse.json({ received: true });
}

async function handleWebhook(payload: {
  webhookType: string;
  webhookCode: string;
  plaidItemId: string;
  body: WebhookBody;
}) {
  const { webhookType, webhookCode, plaidItemId } = payload;

  switch (webhookType) {
    case "TRANSACTIONS": {
      await handleTransactionsWebhook(webhookCode, plaidItemId);
      break;
    }
    case "ITEM": {
      await handleItemWebhook(webhookCode, plaidItemId);
      break;
    }
    default: {
      // Unknown webhook type — silently accept so Plaid doesn't retry.
      safeLogError(
        "plaid/webhook",
        new Error(`Unhandled webhook_type: ${webhookType}`),
      );
    }
  }
}

async function handleTransactionsWebhook(
  webhookCode: string,
  plaidItemId: string,
) {
  // Codes that mean "call /transactions/sync now":
  const syncCodes = [
    "SYNC_UPDATES_AVAILABLE",
    "DEFAULT_UPDATE",
    "INITIAL_UPDATE",
    "HISTORICAL_UPDATE",
    "TRANSACTIONS_REMOVED",
  ];

  if (!syncCodes.includes(webhookCode)) {
    return;
  }

  const item = await prisma.plaidItem.findUnique({
    where: { plaidItemId },
    select: { id: true, userId: true, status: true },
  });

  if (!item) {
    safeLogError(
      "plaid/webhook",
      new Error(`PlaidItem not found for item_id=${plaidItemId}`),
    );
    return;
  }

  // Ignore webhooks for items that have been revoked or are in a bad state.
  if (item.status === "REVOKED") {
    return;
  }

  // Update status back to ACTIVE if it was stuck in ERROR / LOGIN_REQUIRED.
  if (item.status === "ERROR" || item.status === "LOGIN_REQUIRED") {
    await prisma.plaidItem.update({
      where: { id: item.id },
      data: { status: "ACTIVE" },
    });
  }

  // Run both transaction sync and recurring-stream sync. These are
  // idempotent (cursor-based) and scoped by userId.
  try {
    await syncPlaidItemTransactions(item.id, item.userId);
  } catch (err) {
    safeLogError(`plaid/webhook syncTx item=${item.id}`, err);
  }

  try {
    await syncRecurringStreams(item.id, item.userId);
  } catch (err) {
    safeLogError(`plaid/webhook syncStreams item=${item.id}`, err);
  }
}

async function handleItemWebhook(
  webhookCode: string,
  plaidItemId: string,
) {
  let newStatus: "ACTIVE" | "LOGIN_REQUIRED" | "ERROR" | "REVOKED" | null =
    null;

  switch (webhookCode) {
    case "ERROR":
      newStatus = "ERROR";
      break;
    case "PENDING_EXPIRATION":
      newStatus = "LOGIN_REQUIRED";
      break;
    case "USER_PERMISSION_REVOKED":
      newStatus = "REVOKED";
      break;
    case "NEW_ACCOUNTS_AVAILABLE":
      // Could refresh account list here; for now just log.
      safeLogError(
        "plaid/webhook",
        new Error(`NEW_ACCOUNTS_AVAILABLE for item_id=${plaidItemId}`),
      );
      return;
    default:
      return;
  }

  if (!newStatus) return;

  await prisma.plaidItem.updateMany({
    where: { plaidItemId },
    data: { status: newStatus },
  });
}
