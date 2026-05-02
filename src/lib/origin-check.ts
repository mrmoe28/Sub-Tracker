import "server-only";

import { NextResponse, type NextRequest } from "next/server";

// Same-origin gate for mutating routes.
//
// This is defense-in-depth: it doesn't replace auth, but once cookie-based
// sessions are added it will block the basic CSRF vector ("malicious site
// runs `fetch('/api/.../decide', { credentials: 'include' })`"). Browsers
// always set `Origin` on POST, so a missing or non-matching `Origin` is
// treated as cross-site and rejected.
export function requireSameOrigin(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) {
    return NextResponse.json(
      { error: "Forbidden: cross-origin request" },
      { status: 403 },
    );
  }

  // Behind a reverse proxy (Coolify, Vercel, etc.), req.url is rebuilt from
  // the internal host/protocol the proxy hands to Next.js, which won't match
  // the public Origin the browser sent. Prefer the standard forwarded
  // headers, then fall back to Host, then to req.url.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = forwardedHost ?? req.headers.get("host");
  const proto =
    forwardedProto?.split(",")[0]?.trim() ??
    new URL(req.url).protocol.replace(":", "");

  const candidates = new Set<string>();
  if (host) candidates.add(`${proto}://${host}`);
  candidates.add(new URL(req.url).origin);

  if (!candidates.has(origin)) {
    return NextResponse.json(
      { error: "Forbidden: cross-origin request" },
      { status: 403 },
    );
  }
  return null;
}
