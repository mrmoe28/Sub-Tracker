import "server-only";

import { createHash, randomBytes } from "node:crypto";

const TOKEN_TTL_DAYS = 7;

export function generateInviteToken(): { plaintext: string; hash: string } {
  // 32 bytes -> 43-char base64url. Plenty of entropy.
  const plaintext = randomBytes(32).toString("base64url");
  const hash = hashInviteToken(plaintext);
  return { plaintext, hash };
}

export function hashInviteToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function inviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}
