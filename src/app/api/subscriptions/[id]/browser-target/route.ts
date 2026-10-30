import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { browserTarget } from "@/lib/browser-target";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    const { id } = await context.params;
    const domain = await browserTarget(user.id, id);
    if (!domain) return NextResponse.json({ error: "This subscription needs a verified merchant domain before Chrome discovery." }, { status: 422 });
    return NextResponse.json({ domain }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    safeLogError("browser-target", error);
    const result = clientErrorMessage(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
