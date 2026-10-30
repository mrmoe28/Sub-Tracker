import { NextResponse, type NextRequest } from "next/server";

import { huntCancelPageForUser } from "@/lib/cancellation-hunt";
import { browserTarget } from "@/lib/browser-target";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";
// Headless-browser login + crawl; the Playwright budget is ~90s.
export const maxDuration = 120;

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
      select: { merchantId: true },
    });
    if (!candidate?.merchantId) {
      return NextResponse.json(
        { error: "Subscription is not linked to a merchant yet." },
        { status: 400 },
      );
    }
    const outcome = await huntCancelPageForUser(user.id, candidate.merchantId, undefined, await browserTarget(user.id, id));
    return NextResponse.json({
      status: outcome.status,
      url: outcome.url,
      candidateId: outcome.candidateId,
      pagesVisited: outcome.pagesVisited,
      message: outcome.note,
    });
  } catch (err) {
    safeLogError("subscriptions/login-and-find", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
