import { NextResponse, type NextRequest } from "next/server";

import { findCancellationCandidatesForMerchant } from "@/lib/cancellation-search";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const candidate = await prisma.subscriptionCandidate.findFirst({
      where: { id, userId: user.id },
      select: { id: true, merchantId: true, name: true },
    });
    if (!candidate) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      );
    }
    if (!candidate.merchantId) {
      return NextResponse.json(
        { error: "This subscription is not linked to a merchant yet." },
        { status: 400 },
      );
    }

    const result = await findCancellationCandidatesForMerchant(
      candidate.merchantId,
    );
    return NextResponse.json(result);
  } catch (err) {
    safeLogError("subscriptions/find-cancellation", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
