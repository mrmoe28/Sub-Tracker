import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { syncPlaidItemTransactions } from "@/lib/plaid-sync";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

interface Body {
  plaidItemId?: string;
}

export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const user = await getCurrentUser();

    const items = body.plaidItemId
      ? await prisma.plaidItem.findMany({
          where: { id: body.plaidItemId, userId: user.id },
          select: { id: true },
        })
      : await prisma.plaidItem.findMany({
          where: { userId: user.id },
          select: { id: true },
        });

    if (items.length === 0) {
      return NextResponse.json(
        { error: "No linked Plaid items for this user." },
        { status: 404 },
      );
    }

    const results = [];
    for (const i of items) {
      const r = await syncPlaidItemTransactions(i.id, user.id);
      results.push({ plaidItemId: i.id, ...r });
    }

    const totals = results.reduce(
      (acc, r) => ({
        added: acc.added + r.added,
        modified: acc.modified + r.modified,
        removed: acc.removed + r.removed,
      }),
      { added: 0, modified: 0, removed: 0 },
    );

    return NextResponse.json({ results, totals });
  } catch (err) {
    safeLogError("plaid/sync-transactions", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
