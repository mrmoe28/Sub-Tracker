import { NextResponse, type NextRequest } from "next/server";
import type {
  SubscriptionCandidateStatus,
  SubscriptionDecision,
} from "@prisma/client";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

type Action = "confirm" | "ignore" | "cancel";

const ACTION_TO_STATE: Record<
  Action,
  { status: SubscriptionCandidateStatus; decision: SubscriptionDecision }
> = {
  confirm: { status: "CONFIRMED", decision: "KEEP" },
  ignore: { status: "DISMISSED", decision: "IGNORE" },
  cancel: { status: "ARCHIVED", decision: "CANCELED" },
};

const NOTES_MAX_LENGTH = 2000;

interface Body {
  action?: Action;
  notes?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action;
    if (!action || !(action in ACTION_TO_STATE)) {
      return NextResponse.json(
        { error: 'action must be "confirm", "ignore", or "cancel"' },
        { status: 400 },
      );
    }

    if (
      typeof body.notes === "string" &&
      body.notes.length > NOTES_MAX_LENGTH
    ) {
      return NextResponse.json(
        { error: `notes must be ${NOTES_MAX_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    const user = await getCurrentUser();
    const candidate = await prisma.subscriptionCandidate.findFirst({
      where: { id, userId: user.id },
    });
    if (!candidate) {
      return NextResponse.json(
        { error: "Subscription not found" },
        { status: 404 },
      );
    }

    const next = ACTION_TO_STATE[action];

    const [updated] = await prisma.$transaction([
      prisma.subscriptionCandidate.update({
        where: { id: candidate.id },
        data: { status: next.status },
      }),
      prisma.userSubscriptionDecision.create({
        data: {
          userId: user.id,
          candidateId: candidate.id,
          decision: next.decision,
          notes: body.notes,
        },
      }),
    ]);

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
    });
  } catch (err) {
    safeLogError("subscriptions/decide", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
