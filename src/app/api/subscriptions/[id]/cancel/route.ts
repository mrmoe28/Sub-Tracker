import { NextResponse, type NextRequest } from "next/server";

import { startCancelAttempt } from "@/lib/cancel-agent";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";
// Headless-browser login + crawl + walk to the cancel control; Playwright budget ~90s.
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
    const attempt = await startCancelAttempt(user.id, id);
    return NextResponse.json(attempt);
  } catch (err) {
    safeLogError("subscriptions/cancel", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
