import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
require("tsx/cjs");
process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.PLAID_CLIENT_ID = "fixture";
process.env.PLAID_SECRET = "fixture";

let attempt;
let archived = false;
let commits = 0;
let loginSubmissions = 0;
let mode = "success";
let origin;
let encrypted;
let encryptedSession;
const attempts = new Map();
const owned = ({ where }) => {
  const row = attempts.get(where.id);
  if (!row || (where.userId && where.userId !== row.userId)) throw new Error("Not found");
  return row;
};
globalThis.prisma = {
  subscriptionCandidate: {
    findFirstOrThrow: async () => ({ id: "candidate", name: "Fixture", merchantId: "merchant", merchant: { name: "Fixture" } }),
    update: async () => { archived = true; return {}; },
  },
  cancelAttempt: {
    findFirst: async () => null,
    findFirstOrThrow: async (query) => owned(query),
    findUniqueOrThrow: async (query) => owned(query),
    create: async ({ data }) => {
      attempt = { ...data, id: `attempt-${attempts.size}`, status: "RUNNING" };
      attempts.set(attempt.id, attempt);
      return attempt;
    },
    update: async ({ where, data }) => Object.assign(owned({ where }), data),
    updateMany: async ({ where, data }) => {
      const row = owned({ where });
      if (row.status !== where.status) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  merchant: { findUniqueOrThrow: async () => ({ id: "merchant", name: "Fixture", domain: "localhost", website: origin }) },
  merchantLogin: {
    findUnique: async () => ({ id: "login", username: "fixture@example.test", loginUrl: `${origin}/login`, passwordCiphertext: encrypted.ciphertext, passwordIv: encrypted.iv, passwordAuthTag: encrypted.authTag, encryptionKeyVersion: 1 }),
    update: async () => ({}),
  },
  browserSession: {
    findUnique: async () => mode === "session" ? { id: "session", domain: "localhost", cookiesCiphertext: encryptedSession.ciphertext, cookiesIv: encryptedSession.iv, cookiesAuthTag: encryptedSession.authTag, encryptionKeyVersion: 1 } : null,
    update: async () => ({}),
  },
  cancellationCandidate: { findMany: async () => [{ url: `${origin}/account` }], upsert: async () => ({ id: "link" }) },
  userSubscriptionDecision: { create: async () => ({}) },
  $transaction: async (operations) => Promise.all(operations),
};

const server = createServer((request, response) => {
  const send = (body) => { response.writeHead(200, { "Content-Type": "text/html" }); response.end(`<!doctype html><html><body>${body}</body></html>`); };
  if (request.url === "/login" && request.method === "POST") {
    loginSubmissions++;
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const fields = new URLSearchParams(body);
      if (fields.get("email") !== "fixture@example.test" || fields.get("password") !== "fixture-password") {
        send("Incorrect password");
        return;
      }
      response.writeHead(302, { Location: mode === "code" ? "/verify" : "/account", "Set-Cookie": "fixture=ok; Path=/" });
      response.end();
    });
  } else if (request.url === "/login") {
    send('<form method="post"><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>');
  } else if (!request.headers.cookie?.includes("fixture=ok")) {
    response.writeHead(302, { Location: "/login" }); response.end();
  } else if (request.url === "/verify" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      response.writeHead(302, { Location: body.includes("code=123456") ? "/account" : "/verify" });
      response.end();
    });
  } else if (request.url === "/verify") {
    send('<h1>Verification code</h1><form method="post"><input name="code" autocomplete="one-time-code"><button type="submit">Verify</button></form>');
  } else if (request.url === "/account") {
    send('<h1>Account</h1><a href="/account/cancel">Cancel membership</a>');
  } else if (request.url === "/account/cancel") {
    send('<h1>Cancel membership?</h1><p>We are sorry to see you go.</p><form method="post" action="/finish"><button type="submit">Yes, cancel</button></form>');
  } else if (request.url === "/finish" && request.method === "POST") {
    commits++;
    send(mode !== "ambiguous" ? '<h1>Your membership has been canceled.</h1>' : '<h1>Sorry to see you go.</h1>');
  } else {
    send('<a href="/account">Account</a>');
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://localhost:${server.address().port}`;
const { encryptToken } = require("../src/lib/token-encryption.ts");
encrypted = encryptToken("fixture-password");
encryptedSession = encryptToken(JSON.stringify([{ name: "fixture", value: "ok", domain: "localhost", path: "/" }]));
const { startCancelAttempt, approveCancelAttempt, abortCancelAttempt, submitCancelCode } = require("../src/lib/cancel-agent.ts");
try {
  for (mode of ["success", "ambiguous", "session", "code"]) {
    archived = false;
    commits = 0;
    let started = await startCancelAttempt("owner", "candidate");
    if (mode === "code") {
      assert.equal(started.status, "NEEDS_CODE", started.note);
      assert.equal((await submitCancelCode("owner", started.id, "000000")).status, "NEEDS_CODE");
      started = await submitCancelCode("owner", started.id, "123456");
    }
    assert.equal(started.status, "AWAITING_APPROVAL", started.note);
    assert.equal(started.url, `${origin}/account`);
    assert.equal(commits, 0);
    assert.ok(started.hasApprovalScreenshot);
    await assert.rejects(approveCancelAttempt("other-user", started.id), /Not found/);
    const first = await approveCancelAttempt("owner", started.id);
    assert.equal(first.status, "AWAITING_APPROVAL", first.note);
    assert.equal(commits, 0);
    const results = await Promise.all([
      approveCancelAttempt("owner", started.id),
      approveCancelAttempt("owner", started.id),
    ]);
    assert.equal(commits, 1, "duplicate approval must not submit twice");
    const result = results.find((value) => value.status !== "RUNNING");
    assert.equal(result.status, mode !== "ambiguous" ? "CANCELED" : "FAILED", result.note);
    assert.equal(archived, mode !== "ambiguous");
    if (mode === "success") {
      assert.ok(result.hasProofScreenshot);
      await writeFile("/tmp/subtracker-fixture-proof.png", attempt.proofScreenshot);
      assert.equal((await abortCancelAttempt("owner", started.id)).status, "CANCELED");
    }
    console.log(`PASS ${mode}: login, link approval, button approval, duplicate protection, evidence`);
  }
  assert.equal(loginSubmissions, 3, "session reuse must not submit the login form");
} finally {
  for (const live of globalThis.__cancelAgentLive?.values() ?? []) {
    clearTimeout(live.timer);
    await live.browser.close();
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
