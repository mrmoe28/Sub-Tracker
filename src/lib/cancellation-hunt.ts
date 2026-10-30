import "server-only";

import { loginAndFindCancelPage, type HuntResult } from "./cancellation-browser";
import { hostnameOf, registrableDomain } from "./cancellation-rank";
import { findCancellationCandidatesForMerchant } from "./cancellation-search";
import { loadMerchantLogin } from "./merchant-login";
import { prisma } from "./prisma";

export interface HuntOutcome extends HuntResult {
  candidateId: string | null;
}

// Sign in with the user's stored login and locate the cancel page. Runs the
// public search first when the merchant has no known domain, so the crawl has
// somewhere to start. The found page is saved as a high-confidence candidate
// (source "browser") — still PENDING_REVIEW until the user approves it.
export async function huntCancelPageForUser(
  userId: string,
  merchantId: string,
): Promise<HuntOutcome> {
  const login = await loadMerchantLogin(userId, merchantId);
  if (!login) {
    return {
      status: "error",
      url: null,
      controlText: null,
      pagesVisited: 0,
      note: "No saved login for this merchant yet.",
      candidateId: null,
    };
  }

  let merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { id: true, name: true, domain: true, website: true },
  });
  let domain =
    merchant.domain ??
    (merchant.website ? hostnameOf(merchant.website) : null) ??
    (login.loginUrl ? hostnameOf(login.loginUrl) : null);
  if (!domain) {
    const searched = await findCancellationCandidatesForMerchant(merchantId);
    domain = searched.merchantDomain;
    merchant = await prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { id: true, name: true, domain: true, website: true },
    });
  }
  if (!domain) {
    return {
      status: "error",
      url: null,
      controlText: null,
      pagesVisited: 0,
      note: `Couldn't identify ${merchant.name}'s website. Add their login page URL to the saved login.`,
      candidateId: null,
    };
  }
  domain = registrableDomain(domain);

  const seeds = await prisma.cancellationCandidate.findMany({
    where: { merchantId, kind: { in: ["cancel", "manage"] } },
    orderBy: { confidence: "desc" },
    take: 6,
    select: { url: true },
  });

  const hunt = await loginAndFindCancelPage({
    merchantName: merchant.name,
    domain,
    username: login.username,
    password: login.password,
    loginUrl: login.loginUrl,
    seedUrls: seeds.map((s) => s.url),
  });

  let candidateId: string | null = null;
  if ((hunt.status === "found_cancel" || hunt.status === "found_account") && hunt.url) {
    const kind = hunt.status === "found_cancel" ? "cancel" : "manage";
    const confidence = hunt.status === "found_cancel" ? 0.95 : 0.7;
    const title =
      hunt.status === "found_cancel"
        ? `${merchant.name}: "${hunt.controlText}" (found after sign-in)`
        : `${merchant.name} account page (found after sign-in)`;
    const row = await prisma.cancellationCandidate.upsert({
      where: { merchantId_url: { merchantId, url: hunt.url } },
      update: { title, snippet: hunt.note, source: "browser", kind, confidence, status: "PENDING_REVIEW" },
      create: { merchantId, url: hunt.url, title, snippet: hunt.note, source: "browser", kind, confidence },
    });
    candidateId = row.id;
  }

  await prisma.merchantLogin.update({
    where: { id: login.id },
    data: {
      lastAttemptAt: new Date(),
      lastAttemptStatus: hunt.status,
      lastAttemptNote: hunt.note,
      lastFoundUrl: hunt.url,
    },
  });

  return { ...hunt, candidateId };
}
