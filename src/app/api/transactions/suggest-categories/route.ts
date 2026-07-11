import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";
import { applySuggestionsForUser } from "@/lib/apply-category-suggestion";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const user = await getCurrentUser();
    const result = await applySuggestionsForUser(user.id);
    return NextResponse.json(result);
  } catch (err) {
    safeLogError("transactions/suggest-categories", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
