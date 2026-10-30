import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
require("tsx/cjs");
Object.assign(process.env, {
  DATABASE_URL: "postgresql://fixture:fixture@localhost:1/fixture",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  PLAID_CLIENT_ID: "fixture", PLAID_SECRET: "fixture", SERPER_API_KEY: "fixture",
});
const merchant = { id: "merchant", name: "Vercel Domains", domain: null, website: null, logins: [] };
const candidate = { merchantId: merchant.id, merchant, browserDomain: null };
let merchantUpdates = 0;
let requests = 0;
let sessionDomain;
globalThis.prisma = {
  subscriptionCandidate: {
    async findFirst({ where }) { return where.id === "subscription" && where.userId === "owner" ? candidate : null; },
    async updateMany({ where, data }) {
      assert.equal(where.userId, "owner"); assert.equal(where.id, "subscription");
      Object.assign(candidate, data); return { count: 1 };
    },
  },
  merchant: {
    async findUniqueOrThrow() { return merchant; },
    async update() { merchantUpdates++; },
  },
  cancellationCandidate: {
    async deleteMany() {},
    async upsert({ create }) { assert.equal(create.status, undefined); return { id: "link", ...create }; },
  },
  emailConnection: { async findMany() { return []; } },
  browserSession: { async upsert({ create }) { sessionDomain = create.domain; return { id: "session", ...create }; } },
};
globalThis.fetch = async (input) => {
  requests++;
  if (String(input) === "https://google.serper.dev/search") {
    return Response.json({ organic: [
      { link: "https://vercel.com/account", title: "Vercel account", position: 1 },
      { link: "https://vercel.com/docs/domains", title: "Vercel domains", position: 2 },
    ] });
  }
  return new Response(null, { status: 200 });
};
const { browserTarget, validBrowserDomain } = require("../src/lib/browser-target.ts");
const { discoverAccount, chooseAccountWebsite } = require("../src/lib/account-discovery.ts");
const { saveBrowserSession } = require("../src/lib/browser-session.ts");
assert.equal(await browserTarget("other", "subscription"), null);
await assert.rejects(discoverAccount("other", "subscription"), /not found/);
assert.equal(requests, 0);
assert.equal(await browserTarget("owner", "subscription"), null);
const result = await discoverAccount("owner", "subscription");
assert.equal(result.domain, null);
assert.equal(result.suggestions[0].domain, "vercel.com");
assert.equal(merchantUpdates, 0, "search must not authorize a cookie domain");
assert.equal(await browserTarget("owner", "subscription"), null);
const token = result.suggestions[0].token;
await assert.rejects(chooseAccountWebsite("other", "subscription", token));
await assert.rejects(chooseAccountWebsite("owner", "another-subscription", token));
await assert.rejects(chooseAccountWebsite("owner", "subscription", `2.${token.slice(2)}`));
const now = Date.now;
Date.now = () => now() + 1000000;
await assert.rejects(chooseAccountWebsite("owner", "subscription", token), /expired/);
Date.now = now;
await chooseAccountWebsite("owner", "subscription", token);
assert.equal(await browserTarget("owner", "subscription"), "vercel.com");
const count = requests;
assert.equal((await discoverAccount("owner", "subscription")).domain, "vercel.com");
assert.equal(requests, count, "remembered selection should not search again");
candidate.browserDomain = null;
merchant.website = "https://merchant.github.io/account";
assert.equal(await browserTarget("owner", "subscription"), "merchant.github.io");
merchant.logins = [{ loginUrl: "https://account.merchant.example/login" }];
assert.equal(await browserTarget("owner", "subscription"), "merchant.github.io");
merchant.website = null;
assert.equal(await browserTarget("owner", "subscription"), "account.merchant.example");
for (const domain of ["localhost", "127.0.0.1", "internal.local", "merchant.example/path", "-merchant.example"]) {
  assert.equal(validBrowserDomain(domain), null);
}
await saveBrowserSession({ userId: "owner", domain: "merchant.github.io", cookies: [] });
assert.equal(sessionDomain, "merchant.github.io");
console.log("PASS: missing-domain discovery, user-bound selection, tamper/expiry rejection, exact-domain isolation, and website/login fallbacks.");
