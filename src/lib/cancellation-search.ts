import "server-only";

import { prisma } from "./prisma";
import {
  extractCancelPhone,
  hostnameOf,
  inferMerchantDomain,
  rankCandidates,
  type CancelKind,
  type RankedCandidate,
  type SearchResult,
} from "./cancellation-rank";

interface SerperResponse {
  organic?: SearchResult[];
}

export interface CancellationSearchResult {
  created: number;
  candidates: Array<{
    id: string;
    url: string;
    title: string | null;
    confidence: number | null;
    kind: CancelKind;
    firstParty: boolean;
  }>;
  // Set when the merchant's own site was found but it has no cancel page —
  // e.g. insurers that only cancel by phone.
  cancelPhone: string | null;
  merchantDomain: string | null;
  // Human-readable outcome shown under the row.
  message: string;
}

function requireSerperKey(): string {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("Missing SERPER_API_KEY in .env");
  }
  return key;
}

// Third-party "cancel-for-a-fee" middlemen — sites that charge to mail a
// "registered letter" or otherwise cancel on the user's behalf. They are never
// the merchant's own cancellation page and must never surface as candidates
// (project rule: never fabricate cancellation URLs; search-discovered links are
// untrusted). Blocked by known host and by the tell-tale "letter + fee" pitch.
const BLOCKED_CANCELLATION_HOSTS = new Set<string>([
  "xpendy.com",
  "unsubby.com",
  "unsubscribe.com",
  "cancel-subscription.net",
  "cancelmysubscription.com",
  "canceleasy.com",
  "donotpay.com",
  "dyme.app",
]);

function isPaidCancellationMiddleman(result: SearchResult): boolean {
  if (!result.link) return false;
  const host = hostnameOf(result.link);
  if (host && BLOCKED_CANCELLATION_HOSTS.has(host)) return true;
  const text = `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase();
  const advertisesLetter =
    /cancellation letter|(registered|certified) letter/.test(text);
  const advertisesFee = /\$\s?\d|for a (small )?fee/.test(text);
  return advertisesLetter && advertisesFee;
}

async function searchSerper(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ q: query, num: 10 }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Serper request failed with status ${response.status}`);
  }
  const data = (await response.json()) as SerperResponse;
  return data.organic ?? [];
}

// A candidate we show must actually load. Dead links (404/410/5xx, DNS
// failures, timeouts) are dropped so the user never clicks into a wall.
// Anything that answers — including 401/403 sign-in walls — is kept.
async function urlIsLive(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  };
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers,
        signal: controller.signal,
        cache: "no-store",
      });
    }
    return res.status < 400 || res.status === 401 || res.status === 403;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function filterLive(candidates: RankedCandidate[]): Promise<RankedCandidate[]> {
  const checks = await Promise.all(candidates.map((c) => urlIsLive(c.url)));
  return candidates.filter((_, i) => checks[i]);
}

function buildQueries(name: string, domain: string | null): string[] {
  const queries = [
    `how to cancel ${name}`,
    `${name} cancel subscription OR cancel membership OR cancel policy`,
  ];
  if (domain) {
    queries.push(`site:${domain} cancel`);
    queries.push(`site:${domain} account OR billing OR "my account" OR "my policy"`);
  } else {
    queries.push(`${name} official site account login`);
  }
  return queries;
}

function describe(
  merchantName: string,
  candidates: RankedCandidate[],
  cancelPhone: string | null,
  domain: string | null,
): string {
  const best = candidates[0];
  if (best?.kind === "cancel" && best.firstParty) {
    return `Found ${merchantName}'s cancellation page. Approve it to attach it to this subscription.`;
  }
  if (best?.firstParty) {
    const where = best.kind === "manage" ? "account page" : "contact page";
    const phone = cancelPhone ? ` To cancel by phone, call ${cancelPhone}.` : "";
    return `${merchantName} has no public cancel page; the closest is their ${where} (cancel lives behind sign-in).${phone}`;
  }
  if (cancelPhone) {
    return `${merchantName} appears to cancel by phone only: call ${cancelPhone}.`;
  }
  if (best) {
    return `No ${merchantName} cancel page found — only third-party how-to articles. Review before approving.`;
  }
  return domain
    ? `Nothing usable found for ${merchantName} (${domain}). Try their account page or call support.`
    : `Nothing usable found for ${merchantName}. The merchant's website could not be identified.`;
}

export async function findCancellationCandidatesForMerchant(
  merchantId: string,
): Promise<CancellationSearchResult> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { id: true, name: true, domain: true, website: true },
  });

  const key = requireSerperKey();
  const knownDomain =
    merchant.domain ?? (merchant.website ? hostnameOf(merchant.website) : null);

  const seen = new Set<string>();
  const searchResults: SearchResult[] = [];
  const collect = async (queries: string[]) => {
    for (const query of queries) {
      const rows = await searchSerper(query, key);
      for (const row of rows) {
        if (!row.link || seen.has(row.link)) continue;
        if (isPaidCancellationMiddleman(row)) continue;
        seen.add(row.link);
        searchResults.push(row);
      }
    }
  };

  await collect(buildQueries(merchant.name, knownDomain));

  // Two-pass: if we had no domain on file, infer it from the first pass and
  // run the site-scoped queries, which are the ones that find the real
  // account/cancel pages.
  let domain = knownDomain;
  if (!domain) {
    domain = inferMerchantDomain(merchant.name, searchResults);
    if (domain) {
      await collect(buildQueries(merchant.name, domain).filter((q) => q.startsWith("site:")));
      await prisma.merchant.update({
        where: { id: merchant.id },
        data: { domain },
      });
    }
  }

  const ranked = rankCandidates(merchant.name, domain, searchResults, 5);
  const live = (await filterLive(ranked)).slice(0, 3);
  const cancelPhone = extractCancelPhone(searchResults);

  // Fresh search supersedes earlier pending suggestions for this merchant so
  // the row shows the current best guess, not whatever was found last time.
  await prisma.cancellationCandidate.deleteMany({
    where: { merchantId: merchant.id, status: "PENDING_REVIEW" },
  });

  let created = 0;
  const candidates: CancellationSearchResult["candidates"] = [];
  for (const c of live) {
    const row = await prisma.cancellationCandidate.upsert({
      where: { merchantId_url: { merchantId: merchant.id, url: c.url } },
      update: {
        title: c.title,
        snippet: c.snippet,
        source: "serper",
        kind: c.kind,
        confidence: c.confidence,
        status: "PENDING_REVIEW",
      },
      create: {
        merchantId: merchant.id,
        url: c.url,
        title: c.title,
        snippet: c.snippet,
        source: "serper",
        kind: c.kind,
        confidence: c.confidence,
      },
    });
    created += 1;
    candidates.push({
      id: row.id,
      url: row.url,
      title: row.title,
      confidence: row.confidence,
      kind: c.kind,
      firstParty: c.firstParty,
    });
  }

  if (cancelPhone && live.length === 0) {
    const note = `Cancel by phone: ${cancelPhone}`;
    await prisma.merchant.update({
      where: { id: merchant.id },
      data: { cancellationNotes: note },
    });
  }

  return {
    created,
    candidates,
    cancelPhone,
    merchantDomain: domain,
    message: describe(merchant.name, live, cancelPhone, domain),
  };
}
