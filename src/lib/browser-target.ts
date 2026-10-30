import "server-only";

import { prisma } from "./prisma";
import { registrableDomain } from "./cancellation-rank";

export async function browserTarget(userId: string, candidateId: string) {
  const candidate = await prisma.subscriptionCandidate.findFirst({
    where: { id: candidateId, userId },
    select: { merchant: { select: { domain: true } } },
  });
  const host = candidate?.merchant?.domain?.toLowerCase();
  if (!host || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return null;
  return registrableDomain(host);
}
