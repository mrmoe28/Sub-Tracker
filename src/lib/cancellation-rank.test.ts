import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compactMerchantName,
  extractCancelPhone,
  inferMerchantDomain,
  rankCandidates,
  registrableDomain,
} from "./cancellation-rank";

// Captured from Serper on 2026-10-29 for the three queries the old code ran.
const natGen = [
  { position: 1, link: "https://nationalgeneral.com/policyholders/my-policy", title: "My Policy | National General Insurance", snippet: "Check your coverage, pay your bill, or file a claim." },
  { position: 2, link: "https://nationalgeneral.com/about-us/contact-us", title: "Contact Us | National General Insurance", snippet: "Call us at 1-800-462-2123." },
  { position: 3, link: "https://nationalgeneral.com/", title: "National General Insurance", snippet: "Review your coverage, make a payment, or file a claim." },
  { position: 4, link: "https://wallethub.com/answers/ci/cancel-national-general-insurance-1000074-2140714187/", title: "How do I cancel National General insurance?", snippet: "To cancel National General insurance, you must contact a representative by calling 1-888-293-5108." },
  { position: 5, link: "https://insurify.com/car-insurance/companies/national-general/cancel-national-general/", title: "How to Cancel Your National General Auto Insurance ...", snippet: "To cancel your National General auto policy, you'll need to call your local agent." },
  { position: 6, link: "https://nationalgeneral.com/legal/termsandconditions-gopaperless.asp", title: "Terms And Conditions | National General Insurance", snippet: "Any late payments may result in the cancellation of your insurance policy." },
  { position: 7, link: "https://www.reddit.com/r/Insurance/comments/1nc3gsl/called_national_general_to_cancel_my_bogus_car/", title: "Called National General to cancel my bogus car insurance ...", snippet: "" },
  { position: 9, link: "https://archive.org/download/national-general-insurance-pay-bill-guide_20260813/national-general-insurance-cancel-service-guide.pdf", title: "National General Insurance Cancel Service", snippet: "" },
  { position: 2, link: "https://login-eservice.nationalgeneral.com/", title: "National General Login", snippet: "" },
  { position: 4, link: "https://eservice.nationalgeneral.com/service", title: "National General MyAccount", snippet: "" },
];

const spotify = [
  { position: 1, link: "https://www.spotify.com/de-en/signed-out/cancel/", title: "Cancel Subscription", snippet: "Please fill out and submit this form in order to proceed with your cancellation." },
  { position: 3, link: "https://support.spotify.com/us/article/cancel-premium/", title: "How to cancel Premium plans", snippet: "Cancel your Premium plan any time on your account page." },
  { position: 4, link: "https://www.reddit.com/r/truespotify/comments/1q0i61x/how_to_cancel_spotify_subscription_in_2026/", title: "HOW TO CANCEL SPOTIFY SUBSCRIPTION IN 2026!?", snippet: "" },
  { position: 5, link: "https://www.youtube.com/watch?v=K9_HeAbPjGs", title: "How To Cancel Spotify Premium Subscription", snippet: "" },
];

test("registrableDomain strips subdomains", () => {
  assert.equal(registrableDomain("login-eservice.nationalgeneral.com"), "nationalgeneral.com");
  assert.equal(registrableDomain("support.spotify.com"), "spotify.com");
  assert.equal(registrableDomain("shop.example.co.uk"), "example.co.uk");
});

test("compactMerchantName drops generic words", () => {
  assert.equal(compactMerchantName("National General Insurance"), "nationalgeneral");
  assert.equal(compactMerchantName("Netflix"), "netflix");
});

test("infers the merchant domain from results, ignoring aggregators", () => {
  assert.equal(inferMerchantDomain("National General Insurance", natGen), "nationalgeneral.com");
  assert.equal(inferMerchantDomain("Spotify", spotify), "spotify.com");
});

test("insurer with no cancel page: first-party account page wins, legal/pdf/social dropped", () => {
  const ranked = rankCandidates("National General Insurance", "nationalgeneral.com", natGen);
  assert.ok(ranked.length > 0, "should surface something, not nothing");
  assert.equal(ranked[0].firstParty, true);
  assert.equal(ranked[0].kind, "manage");
  assert.ok(/nationalgeneral\.com/.test(ranked[0].url));
  for (const c of ranked) {
    assert.ok(!/reddit|archive\.org|termsandconditions/.test(c.url), c.url);
  }
  // third-party how-tos may appear, but never above the merchant's own pages
  const firstThirdParty = ranked.findIndex((c) => !c.firstParty);
  const lastFirstParty = ranked.map((c) => c.firstParty).lastIndexOf(true);
  if (firstThirdParty !== -1) assert.ok(firstThirdParty > lastFirstParty);
});

test("extracts the cancel-by-phone number from how-to snippets", () => {
  assert.equal(extractCancelPhone(natGen), "1-888-293-5108");
});

test("merchant with a real cancel page ranks it first", () => {
  const ranked = rankCandidates("Spotify", "spotify.com", spotify);
  assert.equal(ranked[0].kind, "cancel");
  assert.ok(ranked.every((c) => !/reddit|youtube/.test(c.url)));
});

test("locale duplicates collapse to the locale-free page; forum threads sink", () => {
  const ranked = rankCandidates("Spotify", "spotify.com", [
    ...spotify,
    { position: 2, link: "https://www.spotify.com/signed-out/cancel/", title: "Cancel Subscription", snippet: "" },
    { position: 6, link: "https://community.spotify.com/forum/discussion/7396597/cancel-audiobooks", title: "cancel audiobooks", snippet: "how do I cancel" },
  ]);
  assert.equal(ranked[0].url, "https://www.spotify.com/signed-out/cancel/");
  assert.ok(!ranked.some((c) => c.url.includes("/de-en/")));
  const forum = ranked.find((c) => c.url.includes("community."));
  assert.ok(!forum || (forum.kind === "howto" && ranked.indexOf(forum) === ranked.length - 1));
});
