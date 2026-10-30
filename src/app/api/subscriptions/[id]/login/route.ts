import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { deleteMerchantLogin, saveMerchantLogin } from "@/lib/merchant-login";
import { requireSameOrigin } from "@/lib/origin-check";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

interface Body {
  username?: string;
  password?: string;
  loginUrl?: string;
}

async function ownedMerchantId(candidateId: string, userId: string) {
  const candidate = await prisma.subscriptionCandidate.findFirst({
    where: { id: candidateId, userId },
    select: { merchantId: true },
  });
  return candidate?.merchantId ?? null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const merchantId = await ownedMerchantId(id, user.id);
    if (!merchantId) {
      return NextResponse.json(
        { error: "Subscription is not linked to a merchant yet." },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    const loginUrl = body.loginUrl?.trim() || null;
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required." },
        { status: 400 },
      );
    }
    if (loginUrl && !/^https?:\/\//i.test(loginUrl)) {
      return NextResponse.json(
        { error: "Login URL must start with http:// or https://." },
        { status: 400 },
      );
    }

    const saved = await saveMerchantLogin({
      userId: user.id,
      merchantId,
      username,
      password,
      loginUrl,
    });
    return NextResponse.json({ saved: true, username: saved.username });
  } catch (err) {
    safeLogError("subscriptions/login", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const user = await getCurrentUser();
    const merchantId = await ownedMerchantId(id, user.id);
    if (merchantId) await deleteMerchantLogin(user.id, merchantId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    safeLogError("subscriptions/login", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
