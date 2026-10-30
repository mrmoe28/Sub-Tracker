import "server-only";

import { prisma } from "./prisma";

export function validBrowserDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.toLowerCase().trim();
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
  return host;
}

function websiteDomain(value: string | null | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? validBrowserDomain(url.hostname) : null;
  } catch { return null; }
}

export async function browserTarget(userId: string, candidateId: string) {
  const candidate = await prisma.subscriptionCandidate.findFirst({
    where: { id: candidateId, userId },
    select: { browserDomain: true, merchant: { select: {
      domain: true, website: true,
      logins: { where: { userId }, select: { loginUrl: true }, take: 1 },
    } } },
  });
  return validBrowserDomain(candidate?.browserDomain)
    ?? validBrowserDomain(candidate?.merchant?.domain)
    ?? websiteDomain(candidate?.merchant?.website)
    ?? websiteDomain(candidate?.merchant?.logins?.[0]?.loginUrl);
}
