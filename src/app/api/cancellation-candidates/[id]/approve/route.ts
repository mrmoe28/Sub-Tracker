import { NextResponse, type NextRequest } from "next/server";

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

    const candidate = await prisma.cancellationCandidate.findFirst({
      where: {
        id,
        merchant: {
          candidates: {
            some: { userId: user.id },
          },
        },
      },
      include: { merchant: true },
    });
    if (!candidate) {
      return NextResponse.json(
        { error: "Cancellation candidate not found" },
        { status: 404 },
      );
    }

    await prisma.$transaction([
      prisma.cancellationCandidate.update({
        where: { id: candidate.id },
        data: { status: "APPROVED" },
      }),
      prisma.merchant.update({
        where: { id: candidate.merchantId },
        data: {
          cancellationUrl: candidate.url,
          cancellationNotes: candidate.snippet,
          confidence: candidate.confidence,
          lastVerifiedAt: new Date(),
        },
      }),
    ]);

    return NextResponse.json({
      merchantId: candidate.merchantId,
      cancellationUrl: candidate.url,
    });
  } catch (err) {
    safeLogError("cancellation-candidates/approve", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
