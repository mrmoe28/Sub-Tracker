import { NextResponse, type NextRequest } from "next/server";

import { issueConnectToken } from "@/lib/browser-session";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

// Issues a fresh pairing token for the Connect extension; invalidates any
// previous one.
export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;
  try {
    const user = await getCurrentUser();
    const token = await issueConnectToken(user.id);
    return NextResponse.json({ token });
  } catch (err) {
    safeLogError("connect/token", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
