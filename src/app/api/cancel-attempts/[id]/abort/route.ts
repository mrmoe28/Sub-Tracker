import { NextResponse, type NextRequest } from "next/server";

import { abortCancelAttempt } from "@/lib/cancel-agent";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
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
    return NextResponse.json(await abortCancelAttempt(user.id, id));
  } catch (err) {
    safeLogError("cancel-attempts/abort", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
