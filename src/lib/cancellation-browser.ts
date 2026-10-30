import "server-only";

import { chromium, type Browser, type Page } from "playwright";

import {
  ACCOUNT_PATHS,
  detectBlocker,
  isCancelControl,
  LOGIN_PATHS,
  looksLikeLoginFailure,
  looksLikeSoftBlock,
  scoreNavLink,
  type Blocker,
} from "./cancellation-browser-heuristics";
import type { SessionCookie } from "./browser-session";

export type HuntStatus =
  | "found_cancel"
  | "found_account"
  | "login_failed"
  | "needs_2fa"
  | "captcha"
  | "no_login_form"
  | "session_expired"
  | "not_found"
  | "error";

export interface HuntResult {
  status: HuntStatus;
  // The page where cancellation (or at least the account) lives.
  url: string | null;
  // Visible label of the cancel control we found, if any.
  controlText: string | null;
  pagesVisited: number;
  note: string;
}

export interface HuntInput {
  merchantName: string;
  domain: string;
  username?: string | null;
  password?: string | null;
  loginUrl?: string | null;
  // Live browser cookies captured from the user's own signed-in session
  // (via the Connect extension). Tried before the username/password path.
  cookies?: SessionCookie[];
  // Known first-party pages (from the search step) to seed the crawl.
  seedUrls?: string[];
}

// When passed to loginAndFindCancelPage, the browser is handed to the caller
// instead of closed, so the cancel agent can keep acting on the found page.
export interface BrowserHandle {
  browser: Browser | null;
  page: Page | null;
}

const NAV_TIMEOUT_MS = 20_000;
const TOTAL_BUDGET_MS = 90_000;
const MAX_PAGES = 14;
const MAX_LOGIN_ATTEMPTS = 6;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const DEBUG = process.env.CANCEL_HUNT_DEBUG === "1";
function debug(...args: unknown[]): void {
  if (DEBUG) console.error("[cancel-hunt]", ...args);
}

const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[name*="email" i]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[id*="email" i]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[type="text"]',
];
const PASSWORD_SELECTOR = 'input[type="password"]';
const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'button:has-text("Login")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
];

async function bodyText(page: Page): Promise<string> {
  try {
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    return text.slice(0, 20_000);
  } catch {
    return "";
  }
}

async function frameUrls(page: Page): Promise<string[]> {
  const urls = await Promise.all(page.frames().filter((frame) => frame !== page.mainFrame()).map(async (frame) => {
    try {
      const element = await frame.frameElement();
      const visible = await element.evaluate((node) => {
        if (!(node instanceof Element)) return false;
        const bounds = node.getBoundingClientRect();
        if (bounds.width < 20 || bounds.height < 20) return false;
        for (let current: Element | null = node; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        }
        return true;
      });
      await element.dispose();
      return visible ? frame.url() : null;
    } catch { return null; }
  }));
  return urls.filter((url): url is string => Boolean(url));
}

async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 8_000 });
  } catch {
    // Slow third-party beacons keep some pages from ever going idle; proceed.
  }
}

async function goto(page: Page, url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });
      if (res && res.status() >= 400 && res.status() !== 403) return false;
      await settle(page);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      debug("goto error", url, message);
      // A redirect from the previous page can still be in flight (e.g. a dead
      // session cookie bouncing /account -> /login). Let it land, then retry once.
      if (attempt === 0 && /interrupted by another navigation/i.test(message)) {
        await settle(page);
        continue;
      }
      return false;
    }
  }
  return false;
}

async function firstVisible(
  page: Page,
  selectors: string[],
): Promise<ReturnType<Page["locator"]> | null> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if (await loc.isVisible({ timeout: 400 })) return loc;
    } catch {
      // not present
    }
  }
  return null;
}

// Try to find a login form on the current page. Handles both single-page
// forms and the two-step "email first, then password" pattern. "stuck" means
// the identifier was accepted but no password field ever appeared — usually a
// bot wall or an unknown account, decided by the caller from the page text.
async function submitLogin(
  page: Page,
  username: string,
  password: string,
): Promise<"submitted" | "no_form" | "stuck"> {
  let passwordField = await firstVisible(page, [PASSWORD_SELECTOR]);
  const userField = await firstVisible(page, USERNAME_SELECTORS);

  if (!userField && !passwordField) return "no_form";

  if (userField) {
    await userField.fill(username);
  }
  if (!passwordField) {
    // Two-step flow: advance past the identifier screen.
    const submit = await firstVisible(page, SUBMIT_SELECTORS);
    if (submit) {
      await submit.click({ timeout: 5_000 }).catch(() => undefined);
    } else {
      await page.keyboard.press("Enter").catch(() => undefined);
    }
    await settle(page);
    passwordField = await firstVisible(page, [PASSWORD_SELECTOR]);
    if (!passwordField) {
      // Re-check: some sites render the password field after a delay.
      await page.waitForTimeout(1_500);
      passwordField = await firstVisible(page, [PASSWORD_SELECTOR]);
    }
    if (!passwordField) return "stuck";
  }

  await passwordField.fill(password);
  const submit = await firstVisible(page, SUBMIT_SELECTORS);
  if (submit) {
    await submit.click({ timeout: 5_000 }).catch(() => undefined);
  } else {
    await page.keyboard.press("Enter").catch(() => undefined);
  }
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: NAV_TIMEOUT_MS });
  } catch {
    // SPA logins often don't navigate at all.
  }
  await settle(page);
  return "submitted";
}

interface Control {
  text: string;
  href: string | null;
}

interface NavLink {
  text: string;
  href: string;
}

// Sent to the page as source text rather than a function: bundler transforms
// (tsx/esbuild keepNames, SWC helpers) can inject references like `__name`
// that don't exist in the browser context.
const SCAN_SCRIPT = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const controls = [];
  const links = [];
  const nodes = document.querySelectorAll(
    'a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"]'
  );
  nodes.forEach((el) => {
    if (!visible(el)) return;
    const text = el.tagName === "INPUT" && el.value ? el.value : (el.innerText || el.textContent || "");
    const label = text.trim().replace(/\\s+/g, " ");
    if (!label) return;
    const href = el instanceof HTMLAnchorElement ? el.href : null;
    controls.push({ text: label.slice(0, 120), href });
    if (href) links.push({ text: label.slice(0, 120), href });
  });
  return { controls, links };
})()`;

async function scanPage(page: Page): Promise<{ controls: Control[]; links: NavLink[] }> {
  try {
    return (await page.evaluate(SCAN_SCRIPT)) as { controls: Control[]; links: NavLink[] };
  } catch (err) {
    debug("scan failed", err instanceof Error ? err.message : String(err));
    return { controls: [], links: [] };
  }
}

function sameSite(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

async function launch(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
}

function result(
  status: HuntStatus,
  note: string,
  extra: Partial<HuntResult> = {},
): HuntResult {
  return {
    status,
    url: null,
    controlText: null,
    pagesVisited: 0,
    note,
    ...extra,
  };
}

// Sign in to the merchant with the stored credentials and crawl the account
// area for a cancel control. Never clicks the cancel control itself — the user
// finishes the cancellation; the app only gets them to the right page.
export async function loginAndFindCancelPage(
  input: HuntInput,
  handle?: BrowserHandle,
): Promise<HuntResult> {
  const domain = input.domain.toLowerCase();
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let browser: Browser | null = null;
  let visited = 0;

  try {
    browser = await launch();
    if (handle) handle.browser = browser;
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    if (handle) handle.page = page;

    // 0. Reuse the user's live session when we have one: no password typed,
    //    2FA already cleared in their own browser.
    let viaSession = false;
    if (input.cookies?.length) {
      await context.addCookies(input.cookies);
      const starts = [
        ...(input.seedUrls ?? []).filter((u) => /account|billing|subscription|manage|plan/i.test(u)),
        ...ACCOUNT_PATHS.slice(0, 4).map((p) => `https://www.${domain}${p}`),
        ...ACCOUNT_PATHS.slice(0, 4).map((p) => `https://${domain}${p}`),
      ];
      let tried = 0;
      let lastUrl: string | null = null;
      for (const url of starts) {
        if (Date.now() > deadline || tried >= 4) break;
        if (!(await goto(page, url))) continue;
        visited += 1;
        tried += 1;
        lastUrl = page.url();
        const onLogin =
          /login|signin|sign-in|sign_in|auth|session\/new/i.test(page.url()) ||
          Boolean(await firstVisible(page, [PASSWORD_SELECTOR]));
        debug("session check", page.url(), "onLogin", onLogin);
        if (!onLogin) {
          viaSession = true;
          break;
        }
      }
      if (!viaSession && !(input.username && input.password)) {
        return result(
          "session_expired",
          `${input.merchantName} no longer accepts the saved browser session (it expired or was signed out). Open ${domain} in Chrome while signed in and send the session again, or add a password login.`,
          { url: lastUrl, pagesVisited: visited },
        );
      }
      if (!viaSession) {
        // Drop the dead session before typing a password so stale cookies
        // can't keep bouncing the login page, and let any pending redirect finish.
        await context.clearCookies();
        await settle(page);
        debug("session expired; falling back to password login");
      }
    }

    if (!viaSession) {
    const username = input.username;
    const password = input.password;
    if (!username || !password) {
      return result("error", `No saved login or browser session for ${input.merchantName}.`, {
        pagesVisited: visited,
      });
    }
    // 1. Reach a login form.
    const loginUrls = [
      ...(input.loginUrl ? [input.loginUrl] : []),
      ...(input.seedUrls ?? []).filter((u) => /login|signin|sign-in|account/i.test(u)),
      ...LOGIN_PATHS.map((p) => `https://${domain}${p}`),
      ...LOGIN_PATHS.map((p) => `https://www.${domain}${p}`),
    ];
    let loginOutcome: "submitted" | "no_form" | "stuck" = "no_form";
    let attempts = 0;
    for (const url of loginUrls) {
      if (Date.now() > deadline) break;
      if (attempts >= MAX_LOGIN_ATTEMPTS) break;
      const ok = await goto(page, url);
      debug("login goto", url, "ok", ok);
      if (!ok) continue;
      visited += 1;
      attempts += 1;
      loginOutcome = await submitLogin(page, username, password);
      debug("login outcome", loginOutcome, page.url());
      if (loginOutcome !== "no_form") break;
      // Some sites hide the form behind a "Sign in" link on the landing page.
      const signin = await firstVisible(page, [
        'a:has-text("Sign in")',
        'a:has-text("Log in")',
        'a:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Log in")',
      ]);
      if (signin) {
        await signin.click({ timeout: 5_000 }).catch(() => undefined);
        await settle(page);
        loginOutcome = await submitLogin(page, username, password);
        if (loginOutcome !== "no_form") break;
      }
    }
    if (loginOutcome === "no_form") {
      return result(
        "no_login_form",
        `Couldn't find a sign-in form on ${domain}. Add the exact login page URL and try again.`,
        { pagesVisited: visited },
      );
    }
    if (loginOutcome === "stuck") {
      const text = await bodyText(page);
      const b = detectBlocker(text, await frameUrls(page));
      if (b) {
        return result(
          b,
          `${input.merchantName} blocked the automated sign-in at ${page.url()} (${b}). Sign in yourself there and look for Cancel under your account.`,
          { url: page.url(), pagesVisited: visited },
        );
      }
      if (looksLikeLoginFailure(text)) {
        return result(
          "login_failed",
          `${input.merchantName} didn't recognise the saved email/username.`,
          { url: page.url(), pagesVisited: visited },
        );
      }
      return result(
        "captcha",
        looksLikeSoftBlock(text)
          ? `${input.merchantName} refused the automated sign-in ("something went wrong" — bot protection). Sign in yourself at ${page.url()}.`
          : `${input.merchantName} never showed a password field after the email step. Sign in yourself at ${page.url()}.`,
        { url: page.url(), pagesVisited: visited },
      );
    }

    // 2. Did the login stick?
    const afterText = await bodyText(page);
    const blocker: Blocker | null = detectBlocker(afterText, await frameUrls(page));
    if (blocker) {
      return result(
        blocker,
        blocker === "captcha"
          ? `${input.merchantName} put up a captcha; a bot can't get past it. Sign in yourself at ${page.url()}.`
          : `${input.merchantName} asks for a 2FA/verification code after login. Sign in yourself at ${page.url()} and look for Cancel under your account.`,
        { url: page.url(), pagesVisited: visited },
      );
    }
    if (
      (await firstVisible(page, [PASSWORD_SELECTOR])) &&
      looksLikeLoginFailure(afterText)
    ) {
      return result(
        "login_failed",
        `${input.merchantName} rejected the saved username/password.`,
        { url: page.url(), pagesVisited: visited },
      );
    }
    }

    // 3. Crawl the account area, best links first.
    const queue: { url: string; score: number }[] = [];
    const seen = new Set<string>([normalize(page.url())]);
    const push = (url: string, score: number) => {
      const n = normalize(url);
      if (seen.has(n) || !sameSite(n, domain) || score <= 0) return;
      seen.add(n);
      queue.push({ url: n, score });
    };
    for (const u of input.seedUrls ?? []) push(u, 70);
    for (const p of ACCOUNT_PATHS) push(`https://${domain}${p}`, 30);
    for (const p of ACCOUNT_PATHS) push(`https://www.${domain}${p}`, 29);

    let bestAccount: string | null = null;
    let loaded = true;
    while (visited < MAX_PAGES && Date.now() < deadline) {
      if (loaded) {
      const { controls, links } = await scanPage(page);
      debug("scan", page.url(), "controls", controls.length, "links", links.length);
      const cancel = controls.find((c) => isCancelControl(c.text, c.href));
      if (cancel) {
        return result(
          "found_cancel",
          `${viaSession ? "Used your browser session for" : "Signed in to"} ${input.merchantName} and found "${cancel.text}" on this page.`,
          { url: cancel.href ?? page.url(), controlText: cancel.text, pagesVisited: visited },
        );
      }
      if (!bestAccount && /account|subscription|membership|billing|plan|policy|settings/i.test(page.url())) {
        bestAccount = page.url();
      }
      for (const l of links) push(l.href, scoreNavLink(l.text, l.href));
      queue.sort((a, b) => b.score - a.score);
      }
      const next = queue.shift();
      const current = next?.url ?? null;
      debug("next", current, "queue", queue.length);
      if (!current) break;
      loaded = await goto(page, current);
      if (!loaded) {
        debug("goto failed", current);
        continue;
      }
      visited += 1;
      const text = await bodyText(page);
      const b = detectBlocker(text, await frameUrls(page));
      if (b) {
        return result(b, `${input.merchantName} blocked the browser on ${current} (${b}).`, {
          url: current,
          pagesVisited: visited,
        });
      }
      // Bounced back to a login form: session didn't persist.
      if ((await firstVisible(page, [PASSWORD_SELECTOR])) && visited > 2) {
        break;
      }
    }

    if (bestAccount) {
      return result(
        "found_account",
        `Signed in to ${input.merchantName} but no cancel button was on the ${visited} pages checked. Start from the account page; cancel may need a phone call.`,
        { url: bestAccount, pagesVisited: visited },
      );
    }
    return result(
      "not_found",
      `Signed in to ${input.merchantName} but couldn't locate a cancel or account page in ${visited} pages.`,
      { pagesVisited: visited },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result("error", `Browser run failed: ${msg.slice(0, 200)}`, { pagesVisited: visited });
  } finally {
    if (!handle) await browser?.close().catch(() => undefined);
  }
}

export { bodyText, firstVisible, frameUrls, scanPage, settle };
