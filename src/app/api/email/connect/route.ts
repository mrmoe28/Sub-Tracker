import { randomBytes, createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { GMAIL_SCOPE, googleCredentials } from "@/lib/email-discovery";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export async function POST(request: NextRequest) {
  const denied = requireSameOrigin(request);
  if (denied) return denied;
  try {
    const user = await getCurrentUser();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const origin = new URL(process.env.AUTH_URL || "https://sub.lock28.com").origin;
    const query = new URLSearchParams({
      client_id: googleCredentials().client_id,
      redirect_uri: `${origin}/api/email/callback`, response_type: "code", scope: GMAIL_SCOPE,
      access_type: "offline", prompt: "consent select_account", state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    });
    const response = NextResponse.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` });
    response.cookies.set("__Host-subtracker-email", JSON.stringify({ state, verifier, userId: user.id }), {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
    });
    return response;
  } catch (error) {
    safeLogError("email/connect", error);
    const result = clientErrorMessage(error);
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
}
