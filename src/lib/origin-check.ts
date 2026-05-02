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
  const requestOrigin = new URL(req.url).origin;

  if (!origin || origin !== requestOrigin) {
    return NextResponse.json(
      { error: "Forbidden: cross-origin request" },
      { status: 403 },
    );
  }
  return null;
}
