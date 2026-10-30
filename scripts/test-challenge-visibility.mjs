import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const { frameUrls } = require("../src/lib/cancellation-browser.ts");
const { detectBlocker } = require("../src/lib/cancellation-browser-heuristics.ts");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route("https://www.google.com/recaptcha/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>Fixture verification widget</p>" }));
  await page.setContent('<h1>Billing information</h1><iframe style="display:none" src="https://www.google.com/recaptcha/api2/anchor"></iframe><iframe width="256" height="60" src="https://www.google.com/recaptcha/enterprise/anchor?size=invisible"></iframe>');
  await page.waitForLoadState("load");
  assert.equal((await frameUrls(page)).length, 1);
  assert.equal(detectBlocker("Billing information", await frameUrls(page)), null);
  await page.setContent('<h1>Billing information</h1><iframe width="300" height="80" src="https://www.google.com/recaptcha/api2/anchor"></iframe>');
  await page.waitForLoadState("load");
  assert.equal(detectBlocker("Billing information", await frameUrls(page)), "captcha");
  await page.setContent('<h1>Billing information</h1><div style="opacity:0"><iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe></div>');
  await page.waitForLoadState("load");
  assert.equal(detectBlocker("Billing information", await frameUrls(page)), null);
  assert.equal(detectBlocker("Verify you are human", await frameUrls(page)), "captcha");
  console.log("PASS: hidden/passive CAPTCHA widgets do not block billing; visible challenges and explicit human-verification prompts still stop the agent.");
} finally { await browser.close(); }
