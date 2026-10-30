import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  stdin: {
    contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { SubscriptionRowActions } from "./src/components/subscription-row-actions"; createRoot(document.getElementById("root")).render(<SubscriptionRowActions candidateId="fixture-subscription" status="CONFIRMED" />);',
    resolveDir: process.cwd(), loader: "tsx",
  },
  bundle: true, write: false, platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "fixture-router", setup(plugin) {
    plugin.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
    plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const useRouter = () => ({ refresh() {} });" }));
  } }],
});
let css = "";
for (const name of await readdir(".next/static/chunks")) {
  if (name.endsWith(".css")) css += await readFile(`.next/static/chunks/${name}`, "utf8");
}
const profile = await mkdtemp(path.join(tmpdir(), "subtracker-ui-"));
const extension = path.resolve("extension");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-sandbox"],
});
let selected = false;
let sessionSaved = false;
let cancelRequests = 0;
let approvals = 0;
const attempt = {
  id: "fixture-attempt", status: "AWAITING_APPROVAL", note: "Fixture: approval required before cancellation.",
  pendingControlText: "Cancel membership", hasApprovalScreenshot: true, hasProofScreenshot: false,
};
try {
  await context.route("https://sub.lock28.com/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ json: body });
    if (url.pathname.endsWith("account-discovery")) {
      if (route.request().postDataJSON().action === "choose") selected = true;
      return json(selected ? { domain: "merchant.example" } : {
        domain: null, suggestions: [{ domain: "merchant.example", token: "fixture-proof", evidence: "Fixture search evidence — not a real subscription." }],
      });
    }
    if (url.pathname.endsWith("browser-target")) {
      assert.equal(selected, true, "Chrome access must wait for website selection");
      return json({ domain: "merchant.example" });
    }
    if (url.pathname.endsWith("email-evidence")) return json({ connected: 1, evidence: [], unavailable: [] });
    if (url.pathname.endsWith("live-session")) {
      assert.ok(route.request().postDataJSON().cookies.some((cookie) => cookie.name === "fixture-session"));
      sessionSaved = true;
      return json({ saved: true });
    }
    if (url.pathname.endsWith("/cancel")) {
      assert.equal(sessionSaved, true);
      cancelRequests++;
      return json(attempt);
    }
    if (url.pathname.endsWith("/approve")) {
      approvals++;
      return json({ ...attempt, status: "CANCELED", confirmationText: "Fixture membership has been canceled.", hasProofScreenshot: true });
    }
    if (url.pathname.includes("/api/cancel-attempts/")) return json(attempt);
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundle.outputFiles[0].text });
    return route.fulfill({ contentType: "text/html", body: `<html><head><style>${css}</style></head><body><main style="padding:16px"><h1>Account discovery test fixture</h1><div id="root"></div></main><script src="/fixture.js"></script></body></html>` });
  });
  await context.route("https://merchant.example/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Fixture merchant sign-in</h1>" }));
  const page = await context.newPage();
  await page.goto("https://sub.lock28.com/subscriptions");
  await page.getByRole("button", { name: "Cancel for me", exact: true }).click();
  await page.getByRole("button", { name: "Use merchant.example" }).waitFor();
  assert.equal(cancelRequests, 0);
  await page.screenshot({ path: "/tmp/subtracker-account-discovery-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/subtracker-account-discovery-mobile.png" });
  await page.getByRole("button", { name: "Use merchant.example" }).click();
  const open = page.getByRole("button", { name: "Open Chrome sign-in" });
  await open.waitFor();
  assert.equal(cancelRequests, 0);
  const merchantPage = context.waitForEvent("page");
  await open.click();
  await (await merchantPage).waitForURL("https://merchant.example/");
  await context.addCookies([{ name: "fixture-session", value: "signed-in", domain: "merchant.example", path: "/", secure: true }]);
  await page.getByRole("button", { name: "Continue from Chrome" }).click();
  const approve = page.getByRole("button", { name: "Approve: Cancel membership", exact: true });
  await approve.waitFor();
  assert.equal(cancelRequests, 1);
  assert.equal(approvals, 0);
  await page.screenshot({ path: "/tmp/subtracker-account-discovery-approval.png" });
  await approve.click();
  await page.getByText(/Canceled\. "Fixture membership has been canceled\."/).waitFor();
  assert.equal(approvals, 1);
  console.log("PASS: rendered desktop/mobile discovery, explicit website selection, native Chrome sign-in, session resume, and final approval gate.");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
