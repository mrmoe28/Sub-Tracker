import { NextResponse, type NextRequest } from "next/server";

import { cancelAttemptView } from "@/lib/cancel-agent";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const owned = await prisma.cancelAttempt.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json(await cancelAttemptView(id));
  } catch (err) {
    safeLogError("cancel-attempts/get", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
