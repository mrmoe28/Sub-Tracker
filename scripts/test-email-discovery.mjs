import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
require("tsx/cjs");
Object.assign(process.env, {
  DATABASE_URL: "postgresql://fixture:fixture@localhost:1/fixture",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  PLAID_CLIENT_ID: "fixture", PLAID_SECRET: "fixture",
  AUTH_GOOGLE_ID: "fixture-client", AUTH_GOOGLE_SECRET: "fixture-secret",
});
let connection;
globalThis.prisma = {
  subscriptionCandidate: { async findFirst({ where }) {
    return where.userId === "owner" && where.id === "subscription" ? { merchant: { name: 'Merchant " OR anything' } } : null;
  } },
  emailConnection: { async findMany({ where }) { assert.equal(where.userId, "owner"); return [connection]; } },
};
const { encryptToken } = require("../src/lib/token-encryption.ts");
const { findEmailReceipts } = require("../src/lib/email-discovery.ts");
connection = { email: "fixture@example.com", ...encryptToken("fixture-refresh") };
let fetched = 0;
let fail = false;
globalThis.fetch = async (input, options) => {
  fetched++;
  if (fail) return new Response("{}", { status: 401 });
  const url = new URL(input);
  if (url.hostname === "oauth2.googleapis.com") {
    assert.equal(options.body.get("refresh_token"), "fixture-refresh");
    return Response.json({ access_token: "fixture-access" });
  }
  assert.equal(options.headers.Authorization, "Bearer fixture-access");
  if (url.pathname.endsWith("/messages")) {
    assert.match(url.searchParams.get("q"), /^"Merchant\s+OR anything"/);
    assert.ok(url.searchParams.get("q").includes("{subject:receipt subject:invoice"));
    return Response.json({ messages: [{ id: "receipt" }] });
  }
  assert.equal(url.searchParams.get("format"), "metadata");
  return Response.json({ payload: { headers: [
    { name: "Subject", value: "Monthly receipt" }, { name: "From", value: "billing@merchant.example" },
  ] } });
};
await assert.rejects(findEmailReceipts("other-user", "subscription"), /not linked/);
assert.equal(fetched, 0);
const result = await findEmailReceipts("owner", "subscription");
assert.equal(result.evidence[0].account, "fixture@example.com");
assert.equal(result.evidence[0].subject, "Monthly receipt");
assert.equal(result.unavailable.length, 0);
fail = true;
const failed = await findEmailReceipts("owner", "subscription");
assert.equal(failed.evidence.length, 0);
assert.deepEqual(failed.unavailable, ["fixture@example.com"]);
console.log("PASS: email ownership, encrypted refresh token, metadata-only queries, and revoked consent handling.");
