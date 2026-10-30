import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { chooseAccountWebsite, discoverAccount } from "@/lib/account-discovery";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const user = await getCurrentUser();
    const { id } = await context.params;
    const body = await request.json();
    const result = body.action === "choose"
      ? await chooseAccountWebsite(user.id, id, body.token)
      : await discoverAccount(user.id, id);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    safeLogError("account-discovery", error);
    const result = clientErrorMessage(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
