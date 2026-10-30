// Pure heuristics for the headless-browser cancel-page hunt. No I/O so they can
// be unit tested; the Playwright driver lives in cancellation-browser.ts.

const CANCEL_VERB =
  String.raw`(?:cancel(?:l?ation)?|end|stop|terminate|turn off|disable|don'?t renew|do not renew|opt out of)`;
const CANCEL_OBJECT =
  String.raw`(?:subscription|membership|plan|policy|premium|auto-?renew(?:al)?|renewal|recurring (?:payment|billing)|service|account)`;

export const CANCEL_CONTROL_RE = new RegExp(
  `\\b${CANCEL_VERB}\\b(?:\\s+\\w+){0,3}\\s+${CANCEL_OBJECT}\\b` +
    `|\\b${CANCEL_OBJECT}\\b(?:\\s+\\w+){0,2}\\s+cancel(?:lation)?\\b` +
    String.raw`|^\s*(?:don'?t renew|do not renew|turn off auto-?renew(?:al)?)\s*$`,
  "i",
);

const BARE_CANCEL_RE = /^cancel(?:lation)?$/i;
const CANCEL_HREF_RE = /cancel|unsubscribe|close-?account|end-?membership|auto-?renew/i;

// Visible text (or href) of an on-page control that would start a cancellation.
// A bare "Cancel" only counts when its link points somewhere cancel-ish, since
// every dialog on earth has a Cancel button.
export function isCancelControl(text: string, href: string | null): boolean {
  const label = text.trim().replace(/\s+/g, " ");
  if (label.length > 90) return false;
  if (CANCEL_CONTROL_RE.test(label)) return true;
  if (BARE_CANCEL_RE.test(label) && href && CANCEL_HREF_RE.test(href)) {
    return true;
  }
  return false;
}

const SKIP_NAV_RE =
  /log ?out|sign ?out|privacy|terms|cookie|careers|jobs|blog|press|newsroom|investor|affiliate|gift|language|download|app store|google play|facebook|twitter|instagram|youtube|tiktok|linkedin|help ?center|faq|contact|support|sitemap|accessibility|legal|about us/i;

// Priority of an in-account link for the crawl queue. 0 = don't follow.
export function scoreNavLink(text: string, href: string): number {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return 0;
  const blob = `${text} ${href}`;
  if (SKIP_NAV_RE.test(blob)) return 0;
  if (/cancel|auto-?renew|unsubscribe/i.test(blob)) return 100;
  if (/subscription|membership|plan|billing|payment|renew|premium/i.test(blob)) {
    return 60;
  }
  if (/account|profile|settings|manage|policy|my-|dashboard/i.test(blob)) {
    return 40;
  }
  return 0;
}

export type Blocker = "needs_2fa" | "captcha";

const TWO_FACTOR_RE =
  /\b(?:verification|security|one-?time|authentication|confirmation|6-digit|six-digit) code\b|two-?factor|2-?step verification|2fa\b|authenticator app|we (?:sent|texted|emailed) (?:you )?a code|enter the code|check your (?:phone|email) for|passkey|verify (?:your|it'?s) (?:identity|you)/i;
const CAPTCHA_TEXT_RE =
  /(?<!protected by )(?<!protected by google )\b(?:re|h)?captcha\b|are you (?:a )?(?:human|robot)|verify you(?:'re| are) (?:a )?human|press (?:and|&) hold|unusual traffic|checking your browser|access denied/i;
const CAPTCHA_FRAME_RE = /recaptcha|hcaptcha|turnstile|arkose|funcaptcha|challenges\.cloudflare|perimeterx|datadome/i;

// Something a bot cannot get past. Checked after every submit.
export function detectBlocker(bodyText: string, frameUrls: string[]): Blocker | null {
  if (frameUrls.some((u) => CAPTCHA_FRAME_RE.test(u))) return "captcha";
  if (CAPTCHA_TEXT_RE.test(bodyText)) return "captcha";
  if (TWO_FACTOR_RE.test(bodyText)) return "needs_2fa";
  return null;
}

// Generic "we won't let you proceed" error that bot-protected login pages show
// instead of a password field (Spotify, many Okta/Auth0 tenants).
const SOFT_BLOCK_RE =
  /something went wrong|try again later|please try again|temporarily (?:blocked|unavailable)|too many attempts|suspicious activity/i;

export function looksLikeSoftBlock(bodyText: string): boolean {
  return SOFT_BLOCK_RE.test(bodyText);
}

const LOGIN_FAILURE_RE =
  /incorrect|invalid (?:password|email|username|login|credentials)|doesn'?t match|wrong (?:password|email|username)|couldn'?t find (?:an |your )?account|not recognized|no account (?:found|exists)|unable to (?:log|sign) in|login failed|try again/i;

export function looksLikeLoginFailure(bodyText: string): boolean {
  return LOGIN_FAILURE_RE.test(bodyText);
}

export const LOGIN_PATHS = [
  "/login",
  "/signin",
  "/sign-in",
  "/account/login",
  "/account",
  "/my-account",
  "/customer/account/login",
  "/users/sign_in",
  "/auth/login",
  "/en/login",
];

export const ACCOUNT_PATHS = [
  "/account",
  "/account/subscription",
  "/account/subscriptions",
  "/account/membership",
  "/account/billing",
  "/account/plan",
  "/account/manage",
  "/subscription",
  "/subscriptions",
  "/membership",
  "/billing",
  "/settings/subscription",
  "/settings/billing",
  "/my-account/subscriptions",
  "/youraccount",
  "/cancelplan",
];
