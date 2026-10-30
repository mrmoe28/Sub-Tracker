// Pure ranking logic for cancellation-link search. No I/O here so it can be
// unit-tested against captured search results (see cancellation-rank.test.ts).

export interface SearchResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
}

// cancel  — URL path leads straight into a cancel/unsubscribe flow.
// manage  — merchant's own account/billing/policy page (cancel lives behind sign-in).
// contact — merchant's own contact/support page (merchants that only cancel by phone).
// howto   — third-party article explaining how to cancel (weakest, fallback only).
export type CancelKind = "cancel" | "manage" | "contact" | "howto";

export interface RankedCandidate {
  url: string;
  title: string | null;
  snippet: string | null;
  confidence: number;
  kind: CancelKind;
  firstParty: boolean;
}

export function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function pathnameOf(value: string): string {
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return "";
  }
}

const SECOND_LEVEL_TLDS = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

// "login-eservice.nationalgeneral.com" -> "nationalgeneral.com"
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  if (last.length === 2 && SECOND_LEVEL_TLDS.has(second) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

const GENERIC_NAME_WORDS = new Set([
  "insurance", "inc", "llc", "ltd", "limited", "co", "corp", "corporation",
  "company", "the", "group", "services", "service", "online", "app", "plc",
  "payment", "payments", "subscription", "membership", "store", "shop",
]);

// "National General Insurance" -> "nationalgeneral"; used to decide whether a
// result host belongs to the merchant itself.
export function compactMerchantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC_NAME_WORDS.has(w))
    .join("");
}

function hostMatchesMerchant(domain: string, merchantName: string): boolean {
  const label = domain.split(".")[0].replace(/[^a-z0-9]/g, "");
  const compact = compactMerchantName(merchantName);
  if (label.length < 3 || compact.length < 3) return false;
  if (label === compact || label.includes(compact) || compact.includes(label)) {
    return true;
  }
  const first = merchantName.toLowerCase().split(/[^a-z0-9]+/)[0] ?? "";
  return first.length >= 4 && label === first;
}

// Hosts that are never the merchant: aggregators, how-to sites, social, app stores.
const THIRD_PARTY_HOSTS =
  /(^|\.)(wallethub|insurify|compare|reddit|facebook|youtube|wikipedia|archive|google|apple|trustpilot|bbb|justanswer|quora|x|twitter|linkedin|instagram|tiktok|crunchbase|glassdoor|indeed|yelp|nerdwallet|bankrate|forbes|cnet|techradar|zdnet|howtogeek|lifewire|wikihow|businessinsider|consumeraffairs|sitejabber|pissedconsumer|truebill|rocketmoney|donotpay|xpendy|unsubby|teamdynamix|medium|substack|pinterest)\.(com|org|net|co|app|io)$/;

export function isThirdPartyHost(host: string): boolean {
  return THIRD_PARTY_HOSTS.test(registrableDomain(host));
}

// Guess the merchant's own domain from search results when we have none on
// file: the registrable domain whose name matches the merchant, weighted by
// how often and how high it ranks. Returns null rather than guessing.
export function inferMerchantDomain(
  merchantName: string,
  results: SearchResult[],
): string | null {
  const scores = new Map<string, number>();
  for (const r of results) {
    if (!r.link) continue;
    const host = hostnameOf(r.link);
    if (!host || isThirdPartyHost(host)) continue;
    const domain = registrableDomain(host);
    if (!hostMatchesMerchant(domain, merchantName)) continue;
    const pos = typeof r.position === "number" ? r.position : 10;
    scores.set(domain, (scores.get(domain) ?? 0) + 1 / pos);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [domain, score] of scores) {
    if (score > bestScore) {
      best = domain;
      bestScore = score;
    }
  }
  return best;
}

// Cancel-intent in the URL *path* is the single strongest signal that a link
// takes the user straight to a cancellation flow rather than a help article.
export const CANCEL_PATH_RE =
  /(^|\/)(cancel|unsubscribe|close[-_]?account|end[-_]?membership|cancellation|cancelplan|manage[-_]?(subscription|membership|plan))(\/|$|[-_?.])/;

// Merchant account / billing / policy pages: where the cancel button lives
// behind sign-in when the merchant has no public cancel URL.
const MANAGE_PATH_RE =
  /(^|\/)(account|my[-_]?account|myaccount|my[-_]?policy|policyholders\/my[-_]?policy|billing|subscriptions?|membership|plans?|settings|manage|service|login|sign[-_]?in|signin|dashboard)(\/|$|[-_?.])/;

const CONTACT_PATH_RE =
  /(^|\/)(contact([-_]?us)?|support|help|customer[-_]?service|faq)(\/|$|[-_?.])/;

// Legal/terms/glossary pages mention "cancellation" constantly but never let
// you cancel anything.
const LEGAL_PATH_RE =
  /(terms|legal|privacy|glossary|disclosure|agreement|\.pdf$|uwguide|underwriting)/;

// Pages that are the *opposite* of cancelling — signup/marketing/info.
const ANTI_CANCEL_RE =
  /\b(how to join|sign[- ]?up|signup|register|create (an )?account|pricing|deals?|coupons?|promo|discount|careers?|jobs|start (your )?(free )?trial|get started|download the app)\b/;

const SOCIAL_HOST_RE =
  /(reddit|quora|facebook|x\.com|twitter|youtube|tiktok|instagram|pinterest)\.com$/;

// Merchant-hosted community forums and blogs: first-party host, but a user
// thread is never the cancel page itself.
const FORUM_RE = /(^|\.)(community|forum|forums|blog|answers|discussions?)\./;
const FORUM_PATH_RE = /\/(forum|forums|discussion|discussions|thread|threads|t)\//;

// "/de-en/signed-out/cancel/" and "/signed-out/cancel/" are the same page.
const LOCALE_PREFIX_RE = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?)(?=\/)/i;

function dedupeKey(url: string): string {
  const host = hostnameOf(url) ?? "";
  const path = pathnameOf(url).replace(LOCALE_PREFIX_RE, "").replace(/\/+$/, "");
  return `${registrableDomain(host)}${path}`;
}

function localeDepth(url: string): number {
  return LOCALE_PREFIX_RE.test(pathnameOf(url)) ? 1 : 0;
}

const PHONE_RE =
  /\b(?:1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|\b1[-.\s]?8(?:00|33|44|55|66|77|88)[-.\s][a-z0-9]{3}[-.\s][a-z0-9]{4}\b/i;

// A phone number that a result says to call *to cancel*. Insurers and gyms
// often have no cancel page at all, so this is the real answer for them.
export function extractCancelPhone(results: SearchResult[]): string | null {
  for (const r of results) {
    const text = `${r.title ?? ""} ${r.snippet ?? ""}`;
    if (!/cancel/i.test(text)) continue;
    const m = text.match(PHONE_RE);
    if (m) return m[0].trim();
  }
  return null;
}

export function classify(
  result: SearchResult & { link: string },
  merchantDomain: string | null,
): { kind: CancelKind | null; firstParty: boolean } {
  const host = hostnameOf(result.link);
  const path = pathnameOf(result.link);
  const text = `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase();
  const firstParty =
    !!merchantDomain &&
    !!host &&
    (host === merchantDomain || host.endsWith(`.${merchantDomain}`));
  const mentionsCancel = /cancel|unsubscribe/.test(text);

  if (CANCEL_PATH_RE.test(path)) return { kind: "cancel", firstParty };
  if (firstParty && !LEGAL_PATH_RE.test(path)) {
    if (MANAGE_PATH_RE.test(path)) return { kind: "manage", firstParty };
    if (CONTACT_PATH_RE.test(path)) return { kind: "contact", firstParty };
  }
  if (mentionsCancel) return { kind: "howto", firstParty };
  return { kind: null, firstParty };
}

export function scoreResult(
  merchantName: string,
  merchantDomain: string | null,
  result: SearchResult & { link: string },
): { confidence: number; kind: CancelKind | null; firstParty: boolean } {
  const title = result.title?.toLowerCase() ?? "";
  const snippet = result.snippet?.toLowerCase() ?? "";
  const url = result.link;
  const host = hostnameOf(url);
  const path = pathnameOf(url);
  const haystack = `${title} ${snippet} ${url.toLowerCase()}`;
  const { kind, firstParty } = classify(result, merchantDomain);
  if (!kind) return { confidence: 0, kind, firstParty };
  const isForum = (host != null && FORUM_RE.test(host)) || FORUM_PATH_RE.test(path);

  const merchantWords = merchantName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  let score = 0.2;
  if (firstParty) score += 0.3;
  else if (host && isThirdPartyHost(host)) score -= 0.05;

  if (kind === "cancel") score += 0.35;
  else if (kind === "manage") score += 0.2;
  else if (kind === "contact") score += 0.12;

  if (title.includes("cancel")) score += 0.15;
  else if (haystack.includes("cancel")) score += 0.08;

  if (haystack.includes("subscription") || haystack.includes("membership")) score += 0.05;
  if (merchantWords.some((word) => haystack.includes(word))) score += 0.05;
  if (typeof result.position === "number" && result.position <= 3) score += 0.05;

  if (ANTI_CANCEL_RE.test(haystack) && kind !== "cancel") score -= 0.3;
  if (LEGAL_PATH_RE.test(path)) score -= 0.3;
  if (host && SOCIAL_HOST_RE.test(host)) score -= 0.4;
  if (/\.pdf$/.test(path)) score -= 0.3;
  if (isForum) score -= 0.35;

  // A third-party article is never better than "probably useful".
  if (kind === "howto" && !firstParty) score = Math.min(score, 0.55);

  return {
    confidence: Math.max(0, Math.min(0.98, score)),
    kind: isForum ? "howto" : kind,
    firstParty,
  };
}

export const MIN_CONFIDENCE = 0.4;

const KIND_ORDER: Record<CancelKind, number> = {
  cancel: 0,
  manage: 1,
  contact: 2,
  howto: 3,
};

export function rankCandidates(
  merchantName: string,
  merchantDomain: string | null,
  results: SearchResult[],
  limit = 5,
): RankedCandidate[] {
  const seen = new Set<string>();
  const byKey = new Map<string, number>();
  const ranked: RankedCandidate[] = [];
  for (const r of results) {
    if (!r.link || seen.has(r.link)) continue;
    const host = hostnameOf(r.link);
    if (!host || /(google|bing|yahoo)\.com$/.test(host)) continue;
    seen.add(r.link);
    const { confidence, kind, firstParty } = scoreResult(
      merchantName,
      merchantDomain,
      r as SearchResult & { link: string },
    );
    if (!kind || confidence < MIN_CONFIDENCE) continue;
    const candidate: RankedCandidate = {
      url: r.link,
      title: r.title ?? null,
      snippet: r.snippet ?? null,
      confidence,
      kind,
      firstParty,
    };
    const key = dedupeKey(r.link);
    const existing = byKey.get(key);
    if (existing != null) {
      // Keep the locale-free variant of the same page.
      if (localeDepth(r.link) < localeDepth(ranked[existing].url)) {
        ranked[existing] = candidate;
      }
      continue;
    }
    byKey.set(key, ranked.length);
    ranked.push(candidate);
  }
  ranked.sort((a, b) => {
    // First-party cancel/manage pages always beat third-party articles, no
    // matter how well the article's title matches.
    if (a.firstParty !== b.firstParty) return a.firstParty ? -1 : 1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return b.confidence - a.confidence;
  });
  return ranked.slice(0, limit);
}
