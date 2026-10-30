import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { registrableDomain } from "./cancellation-rank";
import { prisma } from "./prisma";
import { decryptToken, encryptToken } from "./token-encryption";

// Cookie shape as Playwright's BrowserContext.addCookies expects it.
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export function hashConnectToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Issue (or rotate) the pairing token the Connect extension uses. The plain
// token is shown to the user exactly once; only its hash is stored.
export async function issueConnectToken(userId: string): Promise<string> {
  const token = `stc_${randomBytes(24).toString("base64url")}`;
  await prisma.user.update({
    where: { id: userId },
    data: { connectTokenHash: hashConnectToken(token) },
  });
  return token;
}

export async function userForConnectToken(token: string | null) {
  if (!token || !token.startsWith("stc_")) return null;
  return prisma.user.findFirst({
    where: { connectTokenHash: hashConnectToken(token) },
    select: { id: true, email: true },
  });
}

interface ChromeCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

function toPlaywrightSameSite(v: string | undefined): SessionCookie["sameSite"] {
  switch ((v ?? "").toLowerCase()) {
    case "strict":
      return "Strict";
    case "no_restriction":
    case "none":
      return "None";
    default:
      return "Lax";
  }
}

export function normalizeChromeCookies(raw: unknown): SessionCookie[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionCookie[] = [];
  for (const c of raw as ChromeCookie[]) {
    if (!c || typeof c.name !== "string" || typeof c.value !== "string") continue;
    if (typeof c.domain !== "string" || !c.domain) continue;
    out.push({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || "/",
      expires: typeof c.expirationDate === "number" ? Math.floor(c.expirationDate) : -1,
      httpOnly: Boolean(c.httpOnly),
      secure: Boolean(c.secure),
      sameSite: toPlaywrightSameSite(c.sameSite),
    });
  }
  return out;
}

export async function saveBrowserSession(input: {
  userId: string;
  domain: string;
  cookies: SessionCookie[];
  sourceUrl?: string | null;
}) {
  const domain = registrableDomain(input.domain.toLowerCase());
  const enc = encryptToken(JSON.stringify(input.cookies));
  const data = {
    cookiesCiphertext: enc.ciphertext,
    cookiesIv: enc.iv,
    cookiesAuthTag: enc.authTag,
    encryptionKeyVersion: enc.keyVersion,
    cookieCount: input.cookies.length,
    sourceUrl: input.sourceUrl ?? null,
    capturedAt: new Date(),
    lastUsedAt: null,
    lastUseOk: null,
  };
  return prisma.browserSession.upsert({
    where: { userId_domain: { userId: input.userId, domain } },
    update: data,
    create: { userId: input.userId, domain, ...data },
    select: { id: true, domain: true, cookieCount: true },
  });
}

export interface DecryptedBrowserSession {
  id: string;
  domain: string;
  cookies: SessionCookie[];
  capturedAt: Date;
}

// Decrypts in memory only; never log the cookies.
export async function loadBrowserSession(
  userId: string,
  domain: string,
): Promise<DecryptedBrowserSession | null> {
  const row = await prisma.browserSession.findUnique({
    where: { userId_domain: { userId, domain: registrableDomain(domain.toLowerCase()) } },
  });
  if (!row) return null;
  const json = decryptToken({
    accessTokenCiphertext: row.cookiesCiphertext,
    accessTokenIv: row.cookiesIv,
    accessTokenAuthTag: row.cookiesAuthTag,
    encryptionKeyVersion: row.encryptionKeyVersion,
  });
  return {
    id: row.id,
    domain: row.domain,
    cookies: JSON.parse(json) as SessionCookie[],
    capturedAt: row.capturedAt,
  };
}

export async function markBrowserSessionUse(id: string, ok: boolean) {
  await prisma.browserSession.update({
    where: { id },
    data: { lastUsedAt: new Date(), lastUseOk: ok },
  });
}
