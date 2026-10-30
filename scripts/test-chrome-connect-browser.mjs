import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const profile = await mkdtemp(path.join(tmpdir(), "subtracker-connect-test-"));
const extension = path.resolve("extension");
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-sandbox"],
});
try {
  let captured = false;
  await context.route("https://sub.lock28.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("browser-target")) {
      return route.fulfill({ json: { domain: "merchant.example" } });
    }
    if (url.pathname === "/api/connect/live-session") {
      assert.equal(route.request().headers().origin, "https://sub.lock28.com");
      const body = route.request().postDataJSON();
      assert.equal(body.candidateId, "fixture-subscription");
      assert.ok(body.cookies.some((cookie) => cookie.name === "fixture-session" && cookie.value === "signed-in"));
      captured = true;
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({ contentType: "text/html", body: "<h1>Sub-Tracker Chrome connection fixture</h1>" });
  });
  await context.route("https://merchant.example/**", (route) => route.fulfill({
    contentType: "text/html", body: "<h1>Signed in merchant fixture</h1>",
  }));
  await context.addCookies([{ name: "fixture-session", value: "signed-in", domain: "merchant.example", path: "/", secure: true, httpOnly: true }]);
  const merchant = await context.newPage();
  await merchant.goto("https://merchant.example/account");
  const app = await context.newPage();
  await app.goto("https://sub.lock28.com/subscriptions");
  const discover = (action = "discover") => app.evaluate((action) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Extension bridge timed out")), 15000);
    window.addEventListener("message", (event) => {
      if (event.data?.channel === "subtracker-response" && event.data.id === "fixture-request") {
        clearTimeout(timer);
        resolve(event.data);
      }
    });
    window.postMessage({ channel: "subtracker-request", action, candidateId: "fixture-subscription", id: "fixture-request" }, location.origin);
  }), action);
  const result = await discover();
  assert.equal(result.saved, true, JSON.stringify(result));
  assert.equal(result.cookies, undefined);
  assert.equal(captured, true);
  await merchant.close();
  captured = false;
  const savedSession = await discover();
  assert.equal(savedSession.saved, true, JSON.stringify(savedSession));
  assert.equal(savedSession.cookies, undefined);
  assert.equal(captured, true);
  const openedPage = context.waitForEvent("page");
  const opened = await discover("open");
  assert.equal(opened.opened, true);
  const loginPage = await openedPage;
  await loginPage.waitForURL("https://merchant.example/");
  assert.equal(opened.cookies, undefined);
  await app.screenshot({ path: "/tmp/subtracker-connect-browser-fixture.png" });
  console.log("PASS: actual Chromium extension imports matching-tab and closed-tab sessions without exposing cookies in page messages.");
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
