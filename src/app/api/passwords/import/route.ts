import { NextResponse, type NextRequest } from "next/server";

import { registrableDomain } from "@/lib/cancellation-rank";
import { getCurrentUser } from "@/lib/current-user";
import { saveMerchantLogin } from "@/lib/merchant-login";
import { requireSameOrigin } from "@/lib/origin-check";
import { parsePasswordCsv } from "@/lib/password-import";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

// Body is the raw Chrome / Google Password Manager CSV. Only rows whose
// domain matches a merchant on one of this user's subscriptions are stored
// (encrypted); everything else is dropped. Passwords are never logged.
export async function POST(req: NextRequest) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;
  try {
    const user = await getCurrentUser();
    const text = await req.text();
    if (!text.trim()) {
      return NextResponse.json({ error: "Empty file." }, { status: 400 });
    }
    if (text.length > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (5 MB max)." }, { status: 413 });
    }
    const rows = parsePasswordCsv(text, registrableDomain);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No url/username/password columns found. Export the CSV from Chrome or Google Password Manager." },
        { status: 400 },
      );
    }

    const subs = await prisma.subscriptionCandidate.findMany({
      where: { userId: user.id, merchantId: { not: null } },
      select: {
        merchant: { select: { id: true, name: true, domain: true, website: true } },
      },
    });
    const byDomain = new Map<string, { id: string; name: string }>();
    for (const s of subs) {
      const m = s.merchant;
      if (!m) continue;
      let host = m.domain;
      if (!host && m.website) {
        try {
          host = new URL(m.website).hostname;
        } catch {
          host = null;
        }
      }
      if (host) byDomain.set(registrableDomain(host.toLowerCase()), { id: m.id, name: m.name });
    }

    const matchedNames: string[] = [];
    let unmatched = 0;
    for (const row of rows) {
      const merchant = byDomain.get(row.domain);
      if (!merchant) {
        unmatched += 1;
        continue;
      }
      await saveMerchantLogin({
        userId: user.id,
        merchantId: merchant.id,
        username: row.username,
        password: row.password,
        loginUrl: row.url,
      });
      matchedNames.push(merchant.name);
    }
    return NextResponse.json({
      matched: matchedNames.length,
      unmatched,
      merchants: matchedNames,
    });
  } catch (err) {
    safeLogError("passwords/import", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}
