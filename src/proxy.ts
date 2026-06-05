import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";

// Next.js 16 renamed `middleware.ts` to `proxy.ts`; the runtime still
// defaults to Edge, so we use Auth.js's Edge-safe `auth()` helper
// instead of touching the Prisma adapter directly.
//
// We only need the proxy for /admin/* — gating the rest of the app is
// handled by the (app) layout's `auth()` check and the Auth.js signIn
// callback.

export const config = {
  matcher: ["/admin/:path*"],
};

export default async function proxy(_req: NextRequest) {
  const session = await auth();
  if (!session) {
    const url = new URL("/", _req.url);
    url.searchParams.set("msg", "Sign in to continue.");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
