import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectBlocker,
  isCancelControl,
  looksLikeLoginFailure,
  scoreNavLink,
} from "./cancellation-browser-heuristics";

test("isCancelControl: recognises real cancel controls", () => {
  for (const label of [
    "Cancel membership",
    "Cancel my subscription",
    "Cancel Premium",
    "Cancel plan",
    "End membership",
    "Turn off auto-renew",
    "Cancel auto-renewal",
    "Cancel policy",
    "Don't renew",
    "Subscription cancellation",
  ]) {
    assert.equal(isCancelControl(label, null), true, label);
  }
});

test("isCancelControl: ignores dialog Cancel buttons and unrelated text", () => {
  assert.equal(isCancelControl("Cancel", null), false);
  assert.equal(isCancelControl("Cancel", "https://x.com/account"), false);
  assert.equal(isCancelControl("Cancel", "https://x.com/account/cancel"), true);
  assert.equal(isCancelControl("Cancel order", null), false);
  assert.equal(isCancelControl("Manage subscription", null), false);
  assert.equal(
    isCancelControl(
      "You can cancel your subscription at any time from the billing page by following these steps and then confirming in the dialog",
      null,
    ),
    false,
  );
});

test("scoreNavLink: ranks cancel > billing > account, skips footer junk", () => {
  const cancel = scoreNavLink("Cancel membership", "https://x.com/cancel");
  const billing = scoreNavLink("Billing", "https://x.com/account/billing");
  const account = scoreNavLink("My account", "https://x.com/account");
  assert.ok(cancel > billing && billing > account && account > 0);
  assert.equal(scoreNavLink("Privacy policy", "https://x.com/privacy"), 0);
  assert.equal(scoreNavLink("Log out", "https://x.com/logout"), 0);
  assert.equal(scoreNavLink("Account", "mailto:a@b.com"), 0);
  assert.equal(scoreNavLink("Home", "https://x.com/"), 0);
});

test("detectBlocker: 2FA and captcha", () => {
  assert.equal(
    detectBlocker("We sent you a code. Enter the 6-digit code to continue.", []),
    "needs_2fa",
  );
  assert.equal(
    detectBlocker("Welcome back", ["https://www.google.com/recaptcha/api2/anchor"]),
    "captcha",
  );
  assert.equal(detectBlocker("Please verify you are human", []), "captcha");
  assert.equal(
    detectBlocker(
      "Email / Continue / This site is protected by reCAPTCHA and the Google Privacy Policy apply.",
      [],
    ),
    null,
  );
  assert.equal(detectBlocker("Your plan: Premium. Next bill Nov 1.", []), null);
});

test("looksLikeLoginFailure", () => {
  assert.equal(looksLikeLoginFailure("Incorrect username or password."), true);
  assert.equal(looksLikeLoginFailure("Welcome, Moe"), false);
});
