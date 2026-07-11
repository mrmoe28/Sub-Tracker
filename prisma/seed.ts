import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Curated merchant directory.
//
// IMPORTANT: cancellationUrl values must be human-verified canonical pages.
// We DO NOT fabricate or guess URLs — when we don't have a verified direct
// cancel page, we leave cancellationUrl null and provide cancellationNotes
// so the UI can fall back to the website / support URL with helpful context.

interface MerchantSeed {
  name: string;
  category: string;
  domain?: string;
  website?: string;
  supportUrl?: string;
  cancellationUrl?: string;
  cancellationNotes?: string;
  // 0..1 — how confident we are in the cancel info we have for this merchant.
  confidence: number;
}

const TODAY = new Date();

const transactionCategories = [
  { name: "Subscriptions", group: "Operating", color: "#2563eb", icon: "credit-card", sortOrder: 10 },
  { name: "Software", group: "Operating", color: "#7c3aed", icon: "monitor", sortOrder: 20 },
  { name: "Meals", group: "Expense", color: "#dc2626", icon: "utensils", sortOrder: 30 },
  { name: "Travel", group: "Expense", color: "#0891b2", icon: "plane", sortOrder: 40 },
  { name: "Transportation", group: "Expense", color: "#4f46e5", icon: "car", sortOrder: 50 },
  { name: "Utilities", group: "Expense", color: "#ca8a04", icon: "zap", sortOrder: 60 },
  { name: "Rent", group: "Expense", color: "#9333ea", icon: "home", sortOrder: 70 },
  { name: "Payroll", group: "Income", color: "#16a34a", icon: "wallet", sortOrder: 80 },
  { name: "Transfer", group: "Balance Sheet", color: "#64748b", icon: "repeat", sortOrder: 90 },
  { name: "Taxes", group: "Expense", color: "#b45309", icon: "receipt", sortOrder: 100 },
  { name: "Job Materials", group: "Expense", color: "#ea580c", icon: "package", sortOrder: 35 },
  { name: "Owner's Draw", group: "Balance Sheet", color: "#0d9488", icon: "banknote", sortOrder: 95 },
  { name: "Uncategorized", group: "Review", color: "#6b7280", icon: "circle-help", sortOrder: 999 },
];

const merchants: MerchantSeed[] = [
  {
    name: "Netflix",
    category: "Streaming",
    domain: "netflix.com",
    website: "https://www.netflix.com",
    supportUrl: "https://help.netflix.com",
    cancellationUrl: "https://www.netflix.com/cancelplan",
    cancellationNotes: "Sign in, then visit the cancellation page directly.",
    confidence: 0.95,
  },
  {
    name: "Spotify",
    category: "Streaming",
    domain: "spotify.com",
    website: "https://www.spotify.com",
    supportUrl: "https://support.spotify.com",
    cancellationUrl: "https://www.spotify.com/account/subscription/",
    cancellationNotes:
      "Open Account → Manage your plan → Change or cancel plan.",
    confidence: 0.95,
  },
  {
    name: "Adobe",
    category: "Software",
    domain: "adobe.com",
    website: "https://www.adobe.com",
    supportUrl: "https://helpx.adobe.com",
    cancellationUrl: "https://account.adobe.com/plans",
    cancellationNotes:
      "Sign in to Adobe Account → Plans → Manage plan → Cancel plan. " +
      "Note: cancellation within the first 14 days is free; otherwise an " +
      "early-termination fee may apply for annual plans.",
    confidence: 0.9,
  },
  {
    name: "Amazon Prime",
    category: "Subscriptions",
    domain: "amazon.com",
    website: "https://www.amazon.com",
    supportUrl: "https://www.amazon.com/help",
    // No verified direct cancellation URL — Amazon routes through the
    // logged-in account UI. Leave null and use notes.
    cancellationNotes:
      "On Amazon: Account & Lists → Memberships & Subscriptions → " +
      "Prime Membership → End Membership. Confirm in the cancellation flow.",
    confidence: 0.6,
  },
  {
    name: "Apple",
    category: "Subscriptions",
    domain: "apple.com",
    website: "https://www.apple.com",
    supportUrl: "https://support.apple.com",
    // Apple manages subs via OS settings on the user's device. We don't have
    // a single canonical web cancel URL we're confident in, so leave null.
    cancellationNotes:
      "On iPhone/iPad: Settings → [your name] → Subscriptions. " +
      "On Mac: App Store → click your name → View Information → Manage.",
    confidence: 0.6,
  },
  {
    name: "Google",
    category: "Subscriptions",
    domain: "google.com",
    website: "https://www.google.com",
    supportUrl: "https://support.google.com",
    // Google has many products with separate cancel flows; no single URL.
    cancellationNotes:
      "Sign in to your Google Account → Payments & subscriptions → " +
      "Subscriptions. Specific products (YouTube, Google One) have their " +
      "own cancel paths inside that page.",
    confidence: 0.55,
  },
];

async function main() {
  for (const c of transactionCategories) {
    await prisma.transactionCategory.upsert({
      where: { name: c.name },
      update: {
        group: c.group,
        color: c.color,
        icon: c.icon,
        isDefault: true,
        sortOrder: c.sortOrder,
      },
      create: {
        name: c.name,
        group: c.group,
        color: c.color,
        icon: c.icon,
        isDefault: true,
        sortOrder: c.sortOrder,
      },
    });
  }

  for (const m of merchants) {
    await prisma.merchant.upsert({
      where: { name: m.name },
      update: {
        category: m.category,
        domain: m.domain,
        website: m.website,
        supportUrl: m.supportUrl,
        cancellationUrl: m.cancellationUrl,
        cancellationNotes: m.cancellationNotes,
        confidence: m.confidence,
        lastVerifiedAt: TODAY,
      },
      create: {
        name: m.name,
        category: m.category,
        domain: m.domain,
        website: m.website,
        supportUrl: m.supportUrl,
        cancellationUrl: m.cancellationUrl,
        cancellationNotes: m.cancellationNotes,
        confidence: m.confidence,
        lastVerifiedAt: TODAY,
      },
    });
  }

  const [merchantTotal, categoryTotal] = await Promise.all([
    prisma.merchant.count(),
    prisma.transactionCategory.count(),
  ]);
  console.log(
    `Seed complete. Merchants in DB: ${merchantTotal}. ` +
      `Transaction categories in DB: ${categoryTotal}.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
