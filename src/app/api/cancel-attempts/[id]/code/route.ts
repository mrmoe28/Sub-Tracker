import { NextResponse, type NextRequest } from "next/server";

import { submitCancelCode } from "@/lib/cancel-agent";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";
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
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!code) {
      return NextResponse.json({ error: "Enter the code first." }, { status: 400 });
    }
    return NextResponse.json(await submitCancelCode(user.id, id, code));
  } catch (err) {
    safeLogError("cancel-attempts/code", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
