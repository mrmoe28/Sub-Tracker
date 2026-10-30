import { type NextRequest, NextResponse } from "next/server";

import { screenshotFor } from "@/lib/cancel-agent";
import { getCurrentUser } from "@/lib/current-user";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const kind = req.nextUrl.searchParams.get("kind") === "proof" ? "proof" : "approval";
    const bytes = await screenshotFor(user.id, id, kind);
    if (!bytes) {
      return NextResponse.json({ error: "No screenshot." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    safeLogError("cancel-attempts/screenshot", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
