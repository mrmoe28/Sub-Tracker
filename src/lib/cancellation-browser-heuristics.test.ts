import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cancelConfirmationText,
  classifyCancelControl,
  detectBlocker,
  extractPhoneNumber,
  isCancelControl,
  isLapsed,
  looksLikeLoginFailure,
  looksPhoneOnly,
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

test("classifyCancelControl: confirm vs advance vs keep", () => {
  for (const l of ["Yes, cancel", "Cancel membership", "Confirm cancellation", "Finish cancellation", "Cancel subscription", "I'm sure", "Turn off auto-renew", "Cancel anyway"]) {
    assert.equal(classifyCancelControl(l), "confirm", l);
  }
  for (const l of ["Continue", "Next", "No thanks", "Decline offer", "Continue to cancel"]) {
    assert.equal(classifyCancelControl(l), "advance", l);
  }
  for (const l of ["Keep my plan", "Stay", "Accept offer", "Pause instead", "Get 50% off", "Never mind", "Go back", "Save 30%", "Switch to Basic"]) {
    assert.equal(classifyCancelControl(l), "none", l);
  }
});

test("cancelConfirmationText: finds proof sentences", () => {
  assert.ok(cancelConfirmationText("Done. Your membership has been canceled. You can stream until Nov 12."));
  assert.ok(cancelConfirmationText("Cancellation confirmed."));
  assert.equal(cancelConfirmationText("We're sorry to see you go."), null);
  assert.equal(cancelConfirmationText("If you cancel, you won't be charged again."), null);
  assert.equal(cancelConfirmationText("Access until Nov 12. Finish cancellation?"), null);
  assert.equal(cancelConfirmationText("If your membership is canceled, access ends today."), null);
  assert.equal(cancelConfirmationText("Cancellation complete?"), null);
  assert.equal(cancelConfirmationText("Are you sure you want to cancel?"), null);
  assert.equal(cancelConfirmationText("Manage your membership"), null);
});

test("looksPhoneOnly / extractPhoneNumber", () => {
  assert.equal(looksPhoneOnly("To cancel your policy, please call us at 1-800-468-3466."), true);
  assert.equal(looksPhoneOnly("Cancel membership"), false);
  assert.equal(extractPhoneNumber("call us at 1-800-468-3466 today"), "1-800-468-3466");
});

test("isLapsed: 2 cycles + slack", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  assert.equal(isLapsed(new Date("2025-12-22"), "MONTHLY", now), true);
  assert.equal(isLapsed(new Date("2026-10-26"), "MONTHLY", now), false);
  assert.equal(isLapsed(new Date("2026-08-17"), "MONTHLY", now), true);
  assert.equal(isLapsed(new Date("2026-09-15"), "MONTHLY", now), false);
  assert.equal(isLapsed(new Date("2025-06-01"), "ANNUALLY", now), false);
  assert.equal(isLapsed(null, "MONTHLY", now), false);
  assert.equal(isLapsed(new Date("2025-01-01"), "UNKNOWN", now), false);
});
