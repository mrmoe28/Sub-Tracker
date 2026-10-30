import "server-only";

import { browserTarget, validBrowserDomain } from "./browser-target";
import { discoverMerchantDomain } from "./cancellation-search";
import { isThirdPartyHost } from "./cancellation-rank";
import { findEmailReceipts } from "./email-discovery";
import { prisma } from "./prisma";
import { decryptToken, encryptToken } from "./token-encryption";

function proposal(userId: string, candidateId: string, domain: string) {
  const encrypted = encryptToken(JSON.stringify({ userId, candidateId, domain, expires: Date.now() + 900000 }));
  return [encrypted.keyVersion, ...[encrypted.iv, encrypted.authTag, encrypted.ciphertext].map((bytes) => Buffer.from(bytes).toString("base64url"))].join(".");
}

export async function chooseAccountWebsite(userId: string, candidateId: string, token: unknown) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid website selection.");
  const [version, iv, tag, ciphertext] = token.split(".");
  const selected = JSON.parse(decryptToken({
    encryptionKeyVersion: Number(version), accessTokenIv: Buffer.from(iv ?? "", "base64url"),
    accessTokenAuthTag: Buffer.from(tag ?? "", "base64url"), accessTokenCiphertext: Buffer.from(ciphertext ?? "", "base64url"),
  }));
  const domain = validBrowserDomain(selected.domain);
  if (!domain || selected.userId !== userId || selected.candidateId !== candidateId || !(selected.expires > Date.now())) {
    throw new Error("Website selection expired or belongs to another subscription. Search again.");
  }
  const result = await prisma.subscriptionCandidate.updateMany({ where: { id: candidateId, userId }, data: { browserDomain: domain } });
  if (!result.count) throw new Error("Subscription not found.");
  return { domain };
}

export async function discoverAccount(userId: string, candidateId: string) {
  const candidate = await prisma.subscriptionCandidate.findFirst({ where: { id: candidateId, userId }, select: { merchantId: true, merchant: { select: { name: true } } } });
  if (!candidate?.merchantId || !candidate.merchant) throw new Error("Subscription not found or not linked to a merchant.");
  const domain = await browserTarget(userId, candidateId);
  if (domain) return { domain, suggestions: [], evidence: [], unavailable: [], connected: null, searchUnavailable: false };
  const [search, email] = await Promise.allSettled([
    discoverMerchantDomain(candidate.merchant.name),
    findEmailReceipts(userId, candidateId),
  ]);
  const suggestions: { domain: string; evidence: string; token: string }[] = [];
  const add = (value: string | null, evidence: string) => {
    const host = validBrowserDomain(value);
    if (host && !suggestions.some((item) => item.domain === host)) {
      suggestions.push({ domain: host, evidence, token: proposal(userId, candidateId, host) });
    }
  };
  if (search.status === "fulfilled") {
    add(search.value, "Matched by public website search; confirm this is your provider.");
  }
  if (email.status === "fulfilled") {
    for (const receipt of email.value.evidence) {
      const sender = receipt.sender.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)?.[1];
      if (sender && !isThirdPartyHost(sender) && !/(^|\.)(gmail|outlook|hotmail|yahoo|stripe|paypal|sendgrid|amazonses)\.(com|net)$/i.test(sender)) {
        add(sender, `Receipt sender: ${receipt.subject} — ${receipt.account}. A billing sender may differ from the provider.`);
      }
    }
  }
  return {
    domain: null, suggestions: suggestions.slice(0, 5),
    evidence: email.status === "fulfilled" ? email.value.evidence : [],
    unavailable: email.status === "fulfilled" ? email.value.unavailable : [],
    connected: email.status === "fulfilled" ? email.value.connected : null,
    searchUnavailable: search.status === "rejected",
  };
}
