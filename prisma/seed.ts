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
    // Canonical logged-in Prime management page. Not a one-click cancel — it
    // opens the membership dashboard where "End Membership" lives.
    cancellationUrl: "https://www.amazon.com/gp/primecentral",
    cancellationNotes:
      "Sign in, then on the Prime membership page: End Membership → " +
      "confirm in the cancellation flow (Account & Lists → Prime Membership).",
    confidence: 0.7,
  },
  {
    name: "Apple",
    category: "Subscriptions",
    domain: "apple.com",
    website: "https://www.apple.com",
    supportUrl: "https://support.apple.com",
    // Canonical web page for managing Apple subscriptions; redirects to Apple
    // sign-in, then lists active subscriptions with a Cancel option.
    cancellationUrl: "https://apps.apple.com/account/subscriptions",
    cancellationNotes:
      "Sign in with your Apple ID, then select the subscription → Cancel. " +
      "Also available on-device: Settings → [your name] → Subscriptions.",
    confidence: 0.7,
  },
  {
    name: "Google",
    category: "Subscriptions",
    domain: "google.com",
    website: "https://www.google.com",
    supportUrl: "https://support.google.com",
    // Google spreads subscriptions across products; this is the account-level
    // Payments & subscriptions hub that links to each product's cancel flow.
    cancellationUrl: "https://myaccount.google.com/payments-and-subscriptions",
    cancellationNotes:
      "Sign in, then Payments & subscriptions → Subscriptions → pick the " +
      "product → Cancel. YouTube / Google One have their own cancel paths.",
    confidence: 0.6,
  },
  {
    // Canonical form must match normalizeMerchantName() output ("Youtube"),
    // otherwise ingested transactions won't map to this curated row.
    name: "Youtube",
    category: "Streaming",
    domain: "youtube.com",
    website: "https://www.youtube.com",
    supportUrl: "https://support.google.com/youtube",
    // Canonical logged-in page for YouTube Premium / channel memberships.
    cancellationUrl: "https://www.youtube.com/paid_memberships",
    cancellationNotes:
      "Sign in, then on the Memberships page choose your membership → " +
      "Manage → Deactivate/Cancel.",
    confidence: 0.75,
  },
  {
    name: "Hulu",
    category: "Streaming",
    domain: "hulu.com",
    website: "https://www.hulu.com",
    supportUrl: "https://help.hulu.com",
    // Canonical logged-in account page; Cancel lives under "Your Subscription".
    cancellationUrl: "https://secure.hulu.com/account",
    cancellationNotes:
      "Sign in, then Account → Your Subscription → Cancel.",
    confidence: 0.75,
  },
  {
    name: "Disney Plus",
    category: "Streaming",
    domain: "disneyplus.com",
    website: "https://www.disneyplus.com",
    supportUrl: "https://help.disneyplus.com",
    // Canonical logged-in subscription page for Disney+ direct billing.
    // (If billed via Apple/Google/Amazon, cancel there instead.)
    cancellationUrl: "https://www.disneyplus.com/account/subscription",
    cancellationNotes:
      "Sign in, then Account → Subscription → Cancel Subscription. " +
      "If you subscribed through Apple/Google/Amazon, cancel via that store.",
    confidence: 0.7,
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
