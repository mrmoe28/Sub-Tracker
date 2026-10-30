import "server-only";

import { prisma } from "./prisma";
import { decryptToken } from "./token-encryption";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function googleCredentials() {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google connection is not configured.");
  return { client_id: clientId, client_secret: clientSecret };
}

export async function googleToken(parameters: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", body: new URLSearchParams({ ...googleCredentials(), ...parameters }),
    signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  const token = await response.json();
  if (!response.ok || typeof token.access_token !== "string") {
    throw new Error("Google authorization expired or was denied. Reconnect your email in Settings.");
  }
  return token as { access_token: string; refresh_token?: string; scope?: string };
}

export async function gmailGet(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Gmail read-only access is unavailable. Check the connected account in Settings.");
  return response.json();
}

export async function findEmailReceipts(userId: string, candidateId: string) {
  const candidate = await prisma.subscriptionCandidate.findFirst({
    where: { userId, id: candidateId }, select: { browserDomain: true, merchant: { select: { name: true, domain: true } } },
  });
  if (!candidate?.merchant) throw new Error("This subscription is not linked to a merchant.");
  const connections = await prisma.emailConnection.findMany({ where: { userId } });
  const evidence: { account: string; subject: string; sender: string; date: string; messageId: string }[] = [];
  const unavailable: string[] = [];
  const merchant = candidate.merchant.name.replace(/[^\p{L}\p{N} .&-]/gu, " ").slice(0, 100).trim();
  if (!merchant) return { connected: connections.length, evidence, unavailable };
  for (const connection of connections) {
    try {
      const token = await googleToken({ grant_type: "refresh_token", refresh_token: decryptToken({
        accessTokenCiphertext: connection.ciphertext,
        accessTokenIv: connection.iv,
        accessTokenAuthTag: connection.authTag,
        encryptionKeyVersion: connection.keyVersion,
      }) });
      const billing = "{subject:receipt subject:invoice subject:subscription subject:membership subject:payment subject:renewal}";
      const query = new URLSearchParams({ q: `"${merchant}" ${billing}`, maxResults: "10" });
      let result = await gmailGet(token.access_token, `messages?${query}`);
      if (!result.messages?.length) {
        const knownDomain = candidate.browserDomain ?? candidate.merchant.domain;
        const brand = merchant.split(/\s+/)[0];
        const terms = [`"${merchant}"`];
        if (knownDomain && /^[a-z0-9.-]+$/i.test(knownDomain)) terms.push(`from:${knownDomain}`);
        if (brand.length >= 4 && brand !== merchant) terms.push(`"${brand}"`);
        if (terms.length > 1) {
          const fallback = new URLSearchParams({ q: `{${terms.join(" ")}} ${billing}`, maxResults: "10" });
          result = await gmailGet(token.access_token, `messages?${fallback}`);
        }
      }
      for (const message of result.messages ?? []) {
        const detail = await gmailGet(token.access_token, `messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
        const headers = detail.payload?.headers as { name: string; value: string }[] | undefined;
        const header = (name: string) => headers?.find((item) => item.name.toLowerCase() === name)?.value ?? "";
        evidence.push({ account: connection.email, subject: header("subject"), sender: header("from"), date: header("date"), messageId: message.id });
      }
    } catch {
      unavailable.push(connection.email);
    }
  }
  return { connected: connections.length, evidence, unavailable };
}
