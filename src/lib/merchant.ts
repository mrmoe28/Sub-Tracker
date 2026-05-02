import "server-only";

import { prisma } from "./prisma";

// Light, deterministic merchant-name normalization. The goal is to land
// "NETFLIX.COM", "Netflix Inc", and "Netflix" all on the same Merchant row
// so the curated cancellation URL applies to whatever Plaid sends us.
//
// We deliberately stop short of fuzzy matching — that's a much bigger
// problem (typos, regional brand variants, store numbers) and easy to
// get subtly wrong.
const COMPANY_SUFFIXES = [
  /\b(inc|incorporated|llc|l\.l\.c\.|ltd|limited|co|corp|corporation|plc)\b\.?/gi,
];

const TLD_SUFFIXES = /\.(com|net|org|io|co|app|tv|store)\b/gi;

const TITLE_CASE_EXCEPTIONS = new Set([
  "AT&T",
  "HBO",
  "AMC",
  "ESPN",
  "DVD",
  "USPS",
  "IRS",
]);

export function normalizeMerchantName(input: string): string {
  let s = input.trim();
  // Strip a trailing transaction-id tail Plaid sometimes appends, e.g.
  // "UBER 063015 SF**POOL**".
  s = s.replace(/\s{2,}.*$/, "");
  s = s.replace(TLD_SUFFIXES, "");
  s = s.replace(/[*#]+\d+/g, "");
  for (const re of COMPANY_SUFFIXES) {
    s = s.replace(re, "");
  }
  // Collapse whitespace and punctuation runs.
  s = s.replace(/[,]/g, "");
  s = s.replace(/\s+/g, " ").trim();

  if (TITLE_CASE_EXCEPTIONS.has(s.toUpperCase())) {
    return s.toUpperCase();
  }

  // Title-case word-by-word, preserving 1-2 letter acronyms.
  return s
    .split(" ")
    .map((w) => {
      if (!w) return w;
      if (w.length <= 2) return w.toUpperCase();
      const lower = w.toLowerCase();
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export async function ensureMerchant(name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const canonical = normalizeMerchantName(trimmed);
  if (!canonical) return null;
  return prisma.merchant.upsert({
    where: { name: canonical },
    update: {},
    create: { name: canonical },
  });
}
