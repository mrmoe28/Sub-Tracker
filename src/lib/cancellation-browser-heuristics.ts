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

// ---------- Cancel agent: walking the flow after the cancel control ----------

// Buttons that commit the cancellation. These are the irreversible click the
// agent parks on until the user approves.
const CONFIRM_CANCEL_RE =
  /^(?:yes,?\s*)?(?:cancel|end|stop|terminate|finish cancell?ation|confirm cancell?ation|complete cancell?ation|turn off auto-?renew(?:al)?|don'?t renew|do not renew)(?:\s+(?:my\s+)?(?:subscription|membership|plan|policy|premium|service|account|auto-?renew(?:al)?|renewal|anyway|now))?\s*$|^(?:yes|confirm|i'?m sure|i understand)(?:,?\s*cancel(?:\s+\w+){0,2})?\s*$/i;

// Retention offers and "are you sure you want to leave" bait. Never click.
const KEEP_RE =
  /keep|stay|remain|don'?t cancel|do not cancel|never ?mind|go back|not now|accept (?:offer|discount)|claim (?:offer|discount)|pause|switch (?:plan|to)|downgrade|resume|renew|reactivate|take the deal|get .* off|save \d+%|special offer/i;

// On a page the user is confirming cancellation on, "Continue"/"Next" moves
// toward the final step (survey, reasons). Not irreversible by itself.
const ADVANCE_RE =
  /^(?:continue|next|continue to cancel|continue cancell?ation|proceed(?: with cancell?ation)?|skip|no thanks|no,? thanks|decline(?: offer)?)\s*$/i;

export type CancelStepKind = "confirm" | "advance" | "none";

// Classify a control on a cancel-flow page. "confirm" = final irreversible
// commit; "advance" = safe step forward (decline offer, next); "none" = skip.
export function classifyCancelControl(text: string): CancelStepKind {
  const label = text.trim().replace(/\s+/g, " ");
  if (!label || label.length > 80) return "none";
  if (
    KEEP_RE.test(label) &&
    !/cancel anyway|don'?t renew|do not renew|turn off auto-?renew/i.test(label)
  ) {
    return "none";
  }
  if (CONFIRM_CANCEL_RE.test(label)) return "confirm";
  if (ADVANCE_RE.test(label)) return "advance";
  return "none";
}

// Text that proves the merchant accepted the cancellation.
const CONFIRMATION_RE =
  /\b(?:your |the )?(?:subscription|membership|plan|policy|auto-?renew(?:al)?|renewal|account|service) (?:has been|was|is now|is) (?:cancel+ed|ended|turned off|deactivated|set to expire|scheduled to end)\b|\bcancell?ation (?:confirmed|complete|successful|is complete|has been processed)\b|\byou(?:'ve| have) (?:successfully )?cancel+ed\b|\bauto-?renew(?:al)? (?:is )?(?:off|disabled)\b/i;

export function cancelConfirmationText(bodyText: string): string | null {
  const m = CONFIRMATION_RE.exec(bodyText);
  if (!m) return null;
  const sentenceStart = Math.max(bodyText.lastIndexOf(".", m.index - 1), bodyText.lastIndexOf("\n", m.index - 1)) + 1;
  const prefix = bodyText.slice(sentenceStart, m.index);
  if (/\b(?:if|when|once|after|unless|until|before|whether|not|never|will|would|could|may|might)\b/i.test(prefix)) return null;
  if (bodyText.slice(m.index + m[0].length).trimStart().startsWith("?")) return null;
  const start = Math.max(0, m.index - 80);
  return bodyText.slice(start, m.index + m[0].length + 120).replace(/\s+/g, " ").trim();
}

// Merchants that only cancel by phone/chat. The agent says so up front.
const PHONE_ONLY_RE =
  /(?:to cancel|cancell?ations?)[^.]{0,80}(?:call|phone|contact (?:us|customer service|your agent)|chat with|speak (?:to|with))|(?:call|phone)[^.]{0,60}to cancel|cancel (?:by|over the) phone/i;

export function looksPhoneOnly(bodyText: string): boolean {
  return PHONE_ONLY_RE.test(bodyText);
}

export function extractPhoneNumber(bodyText: string): string | null {
  const m = /(?:\+?1[\s.-]?)?\(?\b(?:8(?:00|33|44|55|66|77|88)|\d{3})\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(bodyText);
  return m ? m[0].trim() : null;
}

// ---------- Lapsed detection ----------

const CYCLE_DAYS: Record<string, number> = {
  WEEKLY: 7,
  BIWEEKLY: 14,
  SEMI_MONTHLY: 15,
  MONTHLY: 31,
  ANNUALLY: 366,
  UNKNOWN: 31,
};

// A subscription that hasn't billed in 2+ cycles (plus a week of slack)
// stopped on its own. There's nothing to cancel; it should leave the list.
export function isLapsed(
  lastSeenAt: Date | null,
  frequency: string,
  now: Date = new Date(),
): boolean {
  if (!lastSeenAt) return false;
  if (frequency === "UNKNOWN" || !CYCLE_DAYS[frequency]) return false;
  const cycle = CYCLE_DAYS[frequency];
  const silentDays = (now.getTime() - lastSeenAt.getTime()) / 86_400_000;
  return silentDays > cycle * 2 + 7;
}
