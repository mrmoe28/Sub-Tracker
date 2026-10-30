import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { GMAIL_SCOPE, gmailGet, googleToken } from "@/lib/email-discovery";
import { encryptToken } from "@/lib/token-encryption";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const origin = new URL(process.env.AUTH_URL || "https://sub.lock28.com").origin;
  let outcome = "failed";
  try {
    const user = await getCurrentUser();
    const state = JSON.parse(request.cookies.get("__Host-subtracker-email")?.value ?? "null");
    const code = request.nextUrl.searchParams.get("code");
    if (!state || state.userId !== user.id || state.state !== request.nextUrl.searchParams.get("state") || !code) {
      throw new Error("Invalid email consent state.");
    }
    const token = await googleToken({ code, grant_type: "authorization_code", code_verifier: state.verifier,
      redirect_uri: `${origin}/api/email/callback` });
    if (!token.refresh_token || !token.scope?.split(" ").includes(GMAIL_SCOPE)) throw new Error("Read-only consent missing.");
    const profile = await gmailGet(token.access_token, "profile");
    if (typeof profile.emailAddress !== "string") throw new Error("No email account.");
    const email = profile.emailAddress.toLowerCase();
    const encrypted = encryptToken(token.refresh_token);
    await prisma.emailConnection.upsert({
      where: { userId_email: { userId: user.id, email } },
      create: { userId: user.id, email, ...encrypted }, update: encrypted,
    });
    outcome = "connected";
  } catch {
    outcome = "failed";
  }
  const response = NextResponse.redirect(`${origin}/settings?email=${outcome}`);
  response.cookies.set("__Host-subtracker-email", "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
