import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { browserTarget } from "@/lib/browser-target";
import { normalizeChromeCookies, saveBrowserSession } from "@/lib/browser-session";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const user = await getCurrentUser();
    const body = await request.json();
    if (typeof body.candidateId !== "string" || typeof body.url !== "string") {
      return NextResponse.json({ error: "Missing subscription or site." }, { status: 400 });
    }
    const domain = await browserTarget(user.id, body.candidateId);
    const url = new URL(body.url);
    if (!domain || url.protocol !== "https:" ||
        !(url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
      return NextResponse.json({ error: "Chrome site does not match this subscription." }, { status: 400 });
    }
    const cookies = normalizeChromeCookies(body.cookies).filter((cookie) => {
      const host = cookie.domain.replace(/^\./, "").toLowerCase();
      return host === domain || host.endsWith(`.${domain}`);
    });
    if (!cookies.length) return NextResponse.json({ error: "No matching session cookies." }, { status: 400 });
    await saveBrowserSession({ userId: user.id, domain, cookies, sourceUrl: url.origin });
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    safeLogError("connect/live-session", error);
    const result = clientErrorMessage(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
