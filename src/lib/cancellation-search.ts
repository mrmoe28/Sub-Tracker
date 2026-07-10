import "server-only";

import { prisma } from "./prisma";

interface SearchResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
}

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
  }>;
}

function requireSerperKey(): string {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("Missing SERPER_API_KEY in .env");
  }
  return key;
}

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function scoreResult(
  merchantName: string,
  merchantDomain: string | null,
  result: SearchResult,
): number {
  const title = result.title?.toLowerCase() ?? "";
  const snippet = result.snippet?.toLowerCase() ?? "";
  const url = result.link ?? "";
  const host = hostnameOf(url);
  const haystack = `${title} ${snippet} ${url.toLowerCase()}`;
  const merchantWords = merchantName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let score = 0.35;
  if (merchantDomain && host === merchantDomain) score += 0.35;
  else if (merchantDomain && host?.endsWith(`.${merchantDomain}`)) score += 0.3;
  if (haystack.includes("cancel")) score += 0.15;
  if (haystack.includes("subscription") || haystack.includes("membership")) score += 0.1;
  if (haystack.includes("billing") || haystack.includes("account")) score += 0.05;
  if (merchantWords.some((word) => haystack.includes(word))) score += 0.1;
  if (host?.includes("support.") || host?.includes("help.")) score += 0.05;
  if (typeof result.position === "number" && result.position <= 3) {
    score += 0.05;
  }
  if (host && /(reddit|quora|facebook|x\.com|twitter|youtube)\.com$/.test(host)) {
    score -= 0.25;
  }

  return Math.max(0.05, Math.min(0.98, score));
}

function isUsefulResult(result: SearchResult): result is SearchResult & { link: string } {
  if (!result.link) return false;
  const host = hostnameOf(result.link);
  if (!host) return false;
  return !/(google|bing|yahoo)\.com$/.test(host);
}

// Third-party "cancel-for-a-fee" middlemen — sites that charge to mail a
// "registered letter" or otherwise cancel on the user's behalf. They are never
// the merchant's own cancellation page and must never surface as candidates
// (project rule: never fabricate cancellation URLs; search-discovered links are
// untrusted). Blocked by known host and by the tell-tale "letter + fee" pitch.
const BLOCKED_CANCELLATION_HOSTS = new Set<string>([
  "unsubby.com",
  "unsubscribe.com",
  "cancel-subscription.net",
  "cancelmysubscription.com",
  "canceleasy.com",
  "donotpay.com",
]);

function isPaidCancellationMiddleman(
  result: SearchResult & { link: string },
): boolean {
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
    body: JSON.stringify({
      q: query,
      num: 10,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Serper request failed with status ${response.status}`);
  }
  const data = (await response.json()) as SerperResponse;
  return data.organic ?? [];
}

export async function findCancellationCandidatesForMerchant(
  merchantId: string,
): Promise<CancellationSearchResult> {
  const merchant = await prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: { id: true, name: true, domain: true },
  });

  const key = requireSerperKey();
  const queries = [
    `${merchant.name} official cancel subscription`,
    `${merchant.name} cancel membership billing support`,
    merchant.domain
      ? `site:${merchant.domain} cancel subscription OR manage billing`
      : `${merchant.name} manage subscription account`,
  ];

  const seen = new Set<string>();
  const searchResults: SearchResult[] = [];
  for (const query of queries) {
    const rows = await searchSerper(query, key);
    for (const row of rows) {
      if (!row.link || seen.has(row.link)) continue;
      seen.add(row.link);
      searchResults.push(row);
    }
  }

  const results = searchResults
    .filter(isUsefulResult)
    .filter((result) => !isPaidCancellationMiddleman(result))
    .map((result) => ({
      result,
      confidence: scoreResult(merchant.name, merchant.domain, result),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  let created = 0;
  const candidates = [];
  for (const { result, confidence } of results) {
    const row = await prisma.cancellationCandidate.upsert({
      where: {
        merchantId_url: {
          merchantId: merchant.id,
          url: result.link,
        },
      },
      update: {
        title: result.title ?? null,
        snippet: result.snippet ?? null,
        source: "serper",
        confidence,
        status: "PENDING_REVIEW",
      },
      create: {
        merchantId: merchant.id,
        url: result.link,
        title: result.title ?? null,
        snippet: result.snippet ?? null,
        source: "serper",
        confidence,
      },
    });
    created += 1;
    candidates.push({
      id: row.id,
      url: row.url,
      title: row.title,
      confidence: row.confidence,
    });
  }

  return { created, candidates };
}
