import "server-only";

import type { Browser, Page } from "playwright";
import type { CancelAttemptStatus } from "@prisma/client";

import {
  bodyText,
  firstVisible,
  frameUrls,
  scanPage,
  settle,
  type BrowserHandle,
} from "./cancellation-browser";
import {
  ACCOUNT_PATHS,
  cancelConfirmationText,
  classifyCancelControl,
  detectBlocker,
  extractPhoneNumber,
  isCancelControl,
  looksPhoneOnly,
  scoreNavLink,
} from "./cancellation-browser-heuristics";
import { huntCancelPageForUser } from "./cancellation-hunt";
import { registrableDomain } from "./cancellation-rank";
import { prisma } from "./prisma";

// The cancel agent: signs in (session or password), walks to the cancel
// flow, declines retention offers, and parks on the final irreversible
// button. It never commits a cancellation without the user's approval, and
// never reports CANCELED without a confirmation screen as proof.

interface Step {
  at: string;
  url: string;
  action: string;
  text?: string;
}

interface LiveAttempt {
  browser: Browser;
  page: Page;
  domain: string;
  merchantName: string;
  steps: Step[];
  pendingControlText: string | null;
  timer: NodeJS.Timeout;
}

// Parked browsers waiting on the user (approval or a 2FA code). Keyed by
// attempt id; one Node process serves the app so this survives requests.
const live: Map<string, LiveAttempt> =
  ((globalThis as { __cancelAgentLive?: Map<string, LiveAttempt> }).__cancelAgentLive ??=
    new Map());

const PARK_TIMEOUT_MS = 15 * 60_000;
const MAX_WALK_STEPS = 8;

export interface AttemptView {
  id: string;
  status: CancelAttemptStatus;
  note: string | null;
  url: string | null;
  pendingControlText: string | null;
  confirmationText: string | null;
  hasApprovalScreenshot: boolean;
  hasProofScreenshot: boolean;
}

async function view(attemptId: string): Promise<AttemptView> {
  const row = await prisma.cancelAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      id: true,
      status: true,
      note: true,
      url: true,
      pendingControlText: true,
      confirmationText: true,
      approvalScreenshot: true,
      proofScreenshot: true,
    },
  });
  if ((row.status === "AWAITING_APPROVAL" || row.status === "NEEDS_CODE") && !live.has(attemptId)) {
    return finish(attemptId, "FAILED", "The browser session ended. Start a new attempt to continue.");
  }
  return {
    id: row.id,
    status: row.status,
    note: row.note,
    url: row.url,
    pendingControlText: row.pendingControlText,
    confirmationText: row.confirmationText,
    hasApprovalScreenshot: Boolean(row.approvalScreenshot?.length),
    hasProofScreenshot: Boolean(row.proofScreenshot?.length),
  };
}

type PngBytes = Uint8Array<ArrayBuffer>;

async function shot(page: Page): Promise<PngBytes | null> {
  try {
    const raw = await page.screenshot({ type: "png" });
    const copy = new Uint8Array(raw.byteLength) as PngBytes;
    copy.set(raw);
    return copy;
  } catch {
    return null;
  }
}

function step(live: LiveAttempt, action: string, text?: string): void {
  live.steps.push({ at: new Date().toISOString(), url: live.page.url(), action, text });
}

async function closeLive(attemptId: string): Promise<void> {
  const l = live.get(attemptId);
  if (!l) return;
  live.delete(attemptId);
  clearTimeout(l.timer);
  await l.browser.close().catch(() => undefined);
}

async function finish(
  attemptId: string,
  status: CancelAttemptStatus,
  note: string,
  extra: {
    url?: string | null;
    steps?: Step[];
    confirmationText?: string | null;
    proofScreenshot?: PngBytes | null;
    approvalScreenshot?: PngBytes | null;
  } = {},
): Promise<AttemptView> {
  await closeLive(attemptId);
  await prisma.cancelAttempt.update({
    where: { id: attemptId },
    data: {
      status,
      note,
      url: extra.url ?? undefined,
      steps: extra.steps ? JSON.parse(JSON.stringify(extra.steps)) : undefined,
      confirmationText: extra.confirmationText ?? undefined,
      proofScreenshot: extra.proofScreenshot ?? undefined,
      approvalScreenshot: extra.approvalScreenshot ?? undefined,
      pendingControlText: null,
      completedAt: new Date(),
    },
  });
  return view(attemptId);
}

async function park(
  attemptId: string,
  l: LiveAttempt,
  status: "AWAITING_APPROVAL" | "NEEDS_CODE",
  note: string,
  pendingControlText: string | null,
): Promise<AttemptView> {
  l.pendingControlText = pendingControlText;
  clearTimeout(l.timer);
  l.timer = setTimeout(() => {
    void finish(attemptId, "FAILED", "Timed out waiting for you (15 min). Run Cancel for me again.", {
      steps: l.steps,
    });
  }, PARK_TIMEOUT_MS);
  await prisma.cancelAttempt.update({
    where: { id: attemptId },
    data: {
      status,
      note,
      url: l.page.url(),
      pendingControlText,
      steps: JSON.parse(JSON.stringify(l.steps)),
      approvalScreenshot: await shot(l.page),
    },
  });
  return view(attemptId);
}

function exact(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
}

async function clickByText(page: Page, text: string): Promise<boolean> {
  const loc = page.getByRole("button", { name: exact(text) })
    .or(page.getByRole("link", { name: exact(text) }))
    .filter({ visible: true });
  if (await loc.count() !== 1) return false;
  try {
    await loc.click({ timeout: 5_000 });
  } catch {
    return false;
  }
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 });
  } catch {
    // SPA step; nothing navigated.
  }
  await settle(page);
  await page.waitForTimeout(800);
  return true;
}

async function walk(attemptId: string, l: LiveAttempt): Promise<AttemptView> {
  const { page, merchantName } = l;
  for (let i = 0; i < MAX_WALK_STEPS; i += 1) {
    const text = await bodyText(page);
    const blocker = detectBlocker(text, frameUrls(page));
    if (blocker === "captcha") {
      return finish(attemptId, "FAILED", `${merchantName} put up a captcha on ${page.url()}; finish from there in your own browser.`, {
        url: page.url(),
        steps: l.steps,
        approvalScreenshot: await shot(page),
      });
    }
    if (blocker === "needs_2fa") {
      return park(attemptId, l, "NEEDS_CODE", `${merchantName} asked for a verification code. Enter the code they sent you.`, null);
    }

    const { controls } = await scanPage(page);
    const commit = controls.find(
      (c) => classifyCancelControl(c.text) === "confirm" || isCancelControl(c.text, c.href),
    );
    if (commit) {
      step(l, "park", commit.text);
      return park(
        attemptId,
        l,
        "AWAITING_APPROVAL",
        `Ready to cancel ${merchantName}. The next click is "${commit.text}" and can't be undone — approve to finish.`,
        commit.text,
      );
    }
    const advance = controls.find((c) => classifyCancelControl(c.text) === "advance");
    if (advance) {
      // Surveys often require a reason before Continue works.
      await page.locator('input[type="radio"]').first().check({ timeout: 800 }).catch(() => undefined);
      step(l, "advance", advance.text);
      if (await clickByText(page, advance.text)) continue;
    }
    if (looksPhoneOnly(text)) {
      const phone = extractPhoneNumber(text);
      return finish(
        attemptId,
        "FAILED",
        `${merchantName} only cancels by phone${phone ? `: call ${phone}` : ""}. Say "I want to cancel my subscription effective immediately and confirm by email."`,
        { url: page.url(), steps: l.steps, approvalScreenshot: await shot(page) },
      );
    }
    break;
  }
  return finish(attemptId, "FAILED", `Reached ${page.url()} but couldn't find the cancel button on it. Screenshot saved.`, {
    url: page.url(),
    steps: l.steps,
    approvalScreenshot: await shot(page),
  });
}

// Minimal crawl used after a 2FA code clears: find a page with a cancel control.
async function crawlToCancel(l: LiveAttempt): Promise<boolean> {
  const { page, domain } = l;
  const queue = ACCOUNT_PATHS.slice(0, 8).map((p) => ({ url: `https://www.${domain}${p}`, score: 30 }));
  const seen = new Set<string>();
  let visited = 0;
  while (queue.length && visited < 10) {
    queue.sort((a, b) => b.score - a.score);
    const next = queue.shift()!;
    if (seen.has(next.url)) continue;
    seen.add(next.url);
    const ok = await page.goto(next.url, { waitUntil: "domcontentloaded", timeout: 20_000 }).then(() => true).catch(() => false);
    if (!ok) continue;
    visited += 1;
    await settle(page);
    const { controls, links } = await scanPage(page);
    if (controls.some((c) => isCancelControl(c.text, c.href) || classifyCancelControl(c.text) === "confirm")) return true;
    for (const link of links) {
      try {
        if (registrableDomain(new URL(link.href).hostname.toLowerCase()) !== domain) continue;
      } catch {
        continue;
      }
      const score = scoreNavLink(link.text, link.href);
      if (score > 0 && !seen.has(link.href)) queue.push({ url: link.href, score });
    }
  }
  return false;
}

export async function startCancelAttempt(userId: string, candidateId: string): Promise<AttemptView> {
  const candidate = await prisma.subscriptionCandidate.findFirstOrThrow({
    where: { id: candidateId, userId },
    select: { id: true, merchantId: true, name: true, merchant: { select: { name: true } } },
  });
  // One live run per subscription.
  const running = await prisma.cancelAttempt.findFirst({
    where: { candidateId, status: { in: ["RUNNING", "AWAITING_APPROVAL", "NEEDS_CODE"] } },
    select: { id: true },
  });
  if (running) {
    if (live.has(running.id)) return view(running.id);
    await finish(running.id, "FAILED", "The app restarted while this was waiting. Run Cancel for me again.");
  }
  const attempt = await prisma.cancelAttempt.create({
    data: { userId, candidateId, merchantId: candidate.merchantId },
    select: { id: true },
  });
  if (!candidate.merchantId) {
    return finish(attempt.id, "FAILED", "This charge isn't linked to a merchant yet, so there's nowhere to sign in.");
  }

  const handle: BrowserHandle = { browser: null, page: null };
  const hunt = await huntCancelPageForUser(userId, candidate.merchantId, handle);
  if (!handle.browser || !handle.page) {
    return finish(attempt.id, "FAILED", hunt.note, { url: hunt.url });
  }
  const merchantName = candidate.merchant?.name ?? candidate.name;
  const l: LiveAttempt = {
    browser: handle.browser,
    page: handle.page,
    domain: registrableDomain(new URL(hunt.url ?? handle.page.url()).hostname.toLowerCase()),
    merchantName,
    steps: [{ at: new Date().toISOString(), url: handle.page.url(), action: "hunt", text: hunt.status }],
    pendingControlText: null,
    timer: setTimeout(() => undefined, 0),
  };
  live.set(attempt.id, l);

  if (hunt.status === "needs_2fa") {
    return park(attempt.id, l, "NEEDS_CODE", `${merchantName} asked for a verification code after sign-in. Enter the code they sent you.`, null);
  }
  if (hunt.status !== "found_cancel" && hunt.status !== "found_account") {
    return finish(attempt.id, "FAILED", hunt.note, { url: hunt.url, steps: l.steps, approvalScreenshot: await shot(l.page) });
  }
  if (hunt.status !== "found_cancel" && hunt.url && hunt.url !== l.page.url()) {
    await l.page.goto(hunt.url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
    await settle(l.page);
  }
  if (hunt.status === "found_account") {
    const text = await bodyText(l.page);
    if (looksPhoneOnly(text)) {
      const phone = extractPhoneNumber(text);
      return finish(attempt.id, "FAILED", `${merchantName} only cancels by phone${phone ? `: call ${phone}` : ""}. Say "I want to cancel my subscription effective immediately and confirm by email."`, {
        url: l.page.url(), steps: l.steps, approvalScreenshot: await shot(l.page),
      });
    }
  }
  return walk(attempt.id, l);
}

export async function approveCancelAttempt(userId: string, attemptId: string): Promise<AttemptView> {
  const row = await prisma.cancelAttempt.findFirstOrThrow({
    where: { id: attemptId, userId },
    select: { id: true, status: true, candidateId: true, pendingControlText: true, url: true },
  });
  const l = live.get(attemptId);
  if (row.status !== "AWAITING_APPROVAL" || !l || !l.pendingControlText) {
    if (row.status === "AWAITING_APPROVAL") {
      return finish(attemptId, "FAILED", "The browser for this attempt is gone (app restarted). Run Cancel for me again.");
    }
    return view(attemptId);
  }
  const label = l.pendingControlText;
  if (row.url !== l.page.url() || row.pendingControlText !== label) {
    return finish(attemptId, "FAILED", "The page changed after approval was requested. Start a new attempt to review it again.");
  }
  const claimed = await prisma.cancelAttempt.updateMany({
    where: { id: attemptId, userId, status: "AWAITING_APPROVAL" },
    data: { status: "RUNNING" },
  });
  if (claimed.count !== 1) return view(attemptId);
  clearTimeout(l.timer);
  const previousProof = cancelConfirmationText(await bodyText(l.page));
  step(l, "confirm", label);
  if (!(await clickByText(l.page, label))) {
    return finish(attemptId, "FAILED", `Couldn't click "${label}" — the page changed. Run Cancel for me again.`, {
      url: l.page.url(), steps: l.steps, approvalScreenshot: await shot(l.page),
    });
  }
  await l.page.waitForTimeout(1_500);
  const text = await bodyText(l.page);
  const proof = cancelConfirmationText(text);
  if (proof && proof !== previousProof) {
    const proofScreenshot = await shot(l.page);
    if (!proofScreenshot) {
      return finish(attemptId, "FAILED", "The site displayed confirmation, but proof could not be saved. Check the merchant before retrying.", {
        url: l.page.url(), steps: l.steps, confirmationText: proof,
      });
    }
    const url = l.page.url();
    await prisma.$transaction([
      prisma.subscriptionCandidate.update({ where: { id: row.candidateId }, data: { status: "ARCHIVED" } }),
      prisma.userSubscriptionDecision.create({
        data: { userId, candidateId: row.candidateId, decision: "CANCELED", notes: `Canceled by Sub-Tracker agent: ${proof}` },
      }),
      prisma.cancelAttempt.update({
        where: { id: attemptId },
        data: {
          status: "CANCELED", note: `${l.merchantName} confirmed: "${proof}"`,
          url, steps: JSON.parse(JSON.stringify(l.steps)), confirmationText: proof,
          proofScreenshot, pendingControlText: null, completedAt: new Date(),
        },
      }),
    ]);
    await closeLive(attemptId);
    return view(attemptId);
  }
  // Another confirm step (some flows have two). Park again — still never
  // click a second commit without approval.
  const { controls } = await scanPage(l.page);
  const next = controls.find((c) => classifyCancelControl(c.text) === "confirm" || isCancelControl(c.text, c.href));
  if (next) {
    step(l, "park", next.text);
    return park(attemptId, l, "AWAITING_APPROVAL", `${l.merchantName} asks once more. Next click is "${next.text}" — approve to finish.`, next.text);
  }
  const advance = controls.find((c) => classifyCancelControl(c.text) === "advance");
  if (advance) {
    return walk(attemptId, l);
  }
  return finish(attemptId, "FAILED", `Clicked "${label}" but ${l.merchantName} showed no confirmation. Check your email for a cancellation notice; screenshot saved.`, {
    url: l.page.url(), steps: l.steps, proofScreenshot: await shot(l.page),
  });
}

export async function abortCancelAttempt(userId: string, attemptId: string): Promise<AttemptView> {
  const row = await prisma.cancelAttempt.findFirstOrThrow({ where: { id: attemptId, userId }, select: { status: true } });
  if (row.status !== "AWAITING_APPROVAL" && row.status !== "NEEDS_CODE") return view(attemptId);
  const l = live.get(attemptId);
  return finish(attemptId, "ABORTED", "Stopped the agent. Previously approved actions are not undone.", { steps: l?.steps });
}

const CODE_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="code" i]',
  'input[id*="code" i]',
  'input[name*="otp" i]',
  'input[inputmode="numeric"]',
  'input[type="tel"]',
  'input[type="text"]',
];

export async function submitCancelCode(userId: string, attemptId: string, code: string): Promise<AttemptView> {
  const row = await prisma.cancelAttempt.findFirstOrThrow({ where: { id: attemptId, userId }, select: { status: true } });
  const l = live.get(attemptId);
  if (row.status !== "NEEDS_CODE" || !l) {
    return row.status === "NEEDS_CODE"
      ? finish(attemptId, "FAILED", "The browser for this attempt is gone (app restarted). Run Cancel for me again.")
      : view(attemptId);
  }
  const field = await firstVisible(l.page, CODE_SELECTORS);
  if (!field) {
    return finish(attemptId, "FAILED", "Couldn't find where to type the code.", { url: l.page.url(), steps: l.steps, approvalScreenshot: await shot(l.page) });
  }
  step(l, "code");
  await field.fill(code.trim());
  await l.page.keyboard.press("Enter").catch(() => undefined);
  await settle(l.page);
  await l.page.waitForTimeout(1_000);
  const text = await bodyText(l.page);
  if (detectBlocker(text, frameUrls(l.page)) === "needs_2fa") {
    return park(attemptId, l, "NEEDS_CODE", `${l.merchantName} didn't accept that code. Try again.`, null);
  }
  await prisma.cancelAttempt.update({ where: { id: attemptId }, data: { status: "RUNNING", note: "Code accepted; looking for the cancel page…" } });
  const { controls } = await scanPage(l.page);
  const here = controls.some((c) => isCancelControl(c.text, c.href) || classifyCancelControl(c.text) === "confirm");
  if (!here && !(await crawlToCancel(l))) {
    return finish(attemptId, "FAILED", `Signed in to ${l.merchantName} but couldn't find the cancel page after the code.`, {
      url: l.page.url(), steps: l.steps, approvalScreenshot: await shot(l.page),
    });
  }
  return walk(attemptId, l);
}

export async function screenshotFor(
  userId: string,
  attemptId: string,
  kind: "approval" | "proof",
): Promise<Uint8Array | null> {
  const row = await prisma.cancelAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { approvalScreenshot: true, proofScreenshot: true },
  });
  if (!row) return null;
  const bytes = kind === "proof" ? row.proofScreenshot : row.approvalScreenshot;
  return bytes?.length ? bytes : null;
}

export { view as cancelAttemptView };
