import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { findEmailReceipts } from "@/lib/email-discovery";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const maxDuration = 120;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const user = await getCurrentUser();
    const { id } = await context.params;
    return NextResponse.json(await findEmailReceipts(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    safeLogError("email-evidence", error);
    const result = clientErrorMessage(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
