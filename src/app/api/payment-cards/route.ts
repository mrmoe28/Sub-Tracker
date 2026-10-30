import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const user = await getCurrentUser();
    const body = (await req.json()) as {
      nickname?: unknown;
      last4?: unknown;
      issuer?: unknown;
    };
    const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 60) : "";
    const digits = typeof body.last4 === "string" ? body.last4.replace(/\D/g, "") : "";
    const issuer = typeof body.issuer === "string" ? body.issuer.trim().slice(0, 60) : "";
    if (!nickname) {
      return NextResponse.json({ error: "Give the card a nickname." }, { status: 400 });
    }
    if (digits.length !== 4) {
      return NextResponse.json(
        { error: "Enter only the last 4 digits. Full card numbers are never stored." },
        { status: 400 },
      );
    }
    const card = await prisma.paymentCard.upsert({
      where: { userId_last4: { userId: user.id, last4: digits } },
      update: { nickname, issuer: issuer || null },
      create: { userId: user.id, nickname, last4: digits, issuer: issuer || null },
      select: { id: true, nickname: true, last4: true, issuer: true },
    });
    return NextResponse.json(card);
  } catch (err) {
    safeLogError("payment-cards/create", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}

export async function DELETE(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const user = await getCurrentUser();
    const id = req.nextUrl.searchParams.get("id") ?? "";
    await prisma.paymentCard.deleteMany({ where: { id, userId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    safeLogError("payment-cards/delete", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
