import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeChromeCookies,
  saveBrowserSession,
  userForConnectToken,
} from "@/lib/browser-session";
import { registrableDomain } from "@/lib/cancellation-rank";
import { safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

// Called by the Sub-Tracker Connect browser extension (bearer = pairing
// token), not by the web UI, so it deliberately skips the same-origin gate.
// Extension origins look like chrome-extension://<id>, which CORS must allow.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface Body {
  url?: string;
  cookies?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const user = await userForConnectToken(bearer);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid pairing token. Generate a new one in Settings." },
        { status: 401, headers: CORS_HEADERS },
      );
    }
    const body = (await req.json().catch(() => ({}))) as Body;
    let host: string;
    try {
      host = new URL(body.url ?? "").hostname.toLowerCase();
    } catch {
      return NextResponse.json(
        { error: "Missing tab URL." },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const cookies = normalizeChromeCookies(body.cookies);
    if (cookies.length === 0) {
      return NextResponse.json(
        { error: "No cookies for this site — are you signed in on this tab?" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const saved = await saveBrowserSession({
      userId: user.id,
      domain: registrableDomain(host),
      cookies,
      sourceUrl: body.url,
    });
    return NextResponse.json(
      { saved: true, domain: saved.domain, cookieCount: saved.cookieCount, user: user.email },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    safeLogError("connect/session", err);
    return NextResponse.json(
      { error: "Could not save session." },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
