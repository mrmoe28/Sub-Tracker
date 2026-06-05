// Seed a couple of test users and invites for local development.
//
// Run with: npx tsx scripts/seed-invite-test.ts
//
// Idempotent: re-running upserts the same fixture rows.

import { PrismaClient } from "@prisma/client";
import { generateInviteToken, inviteExpiresAt } from "../src/lib/invite-token";

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = "owner-test@example.com";
  const memberEmail = "member-test@example.com";

  // Use upsert to make the script re-runnable.
  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: {
      email: ownerEmail,
      name: "Test Owner",
      role: "OWNER",
      emailVerified: new Date(),
    },
    update: { role: "OWNER" },
  });

  await prisma.user.upsert({
    where: { email: memberEmail },
    create: {
      email: memberEmail,
      name: "Test Member",
      role: "MEMBER",
      emailVerified: new Date(),
    },
    update: {},
  });

  // Three invites: one active, one revoked, one expired.
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tomorrow = inviteExpiresAt();
  const lastWeek = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

  // Clean up previous test invites for these emails.
  await prisma.invite.deleteMany({
    where: {
      email: { in: ["active-invite@example.com", "revoked-invite@example.com", "expired-invite@example.com"] },
    },
  });

  const active = generateInviteToken();
  await prisma.invite.create({
    data: {
      email: "active-invite@example.com",
      tokenHash: active.hash,
      invitedById: owner.id,
      expiresAt: tomorrow,
      revokedAt: null,
    },
  });
  console.log("ACTIVE invite link:");
  console.log(`  http://localhost:3000/invite/${active.plaintext}`);

  const revoked = generateInviteToken();
  await prisma.invite.create({
    data: {
      email: "revoked-invite@example.com",
      tokenHash: revoked.hash,
      invitedById: owner.id,
      expiresAt: tomorrow,
      revokedAt: yesterday,
    },
  });
  console.log("REVOKED invite link:");
  console.log(`  http://localhost:3000/invite/${revoked.plaintext}`);

  const expired = generateInviteToken();
  await prisma.invite.create({
    data: {
      email: "expired-invite@example.com",
      tokenHash: expired.hash,
      invitedById: owner.id,
      expiresAt: lastWeek,
      revokedAt: null,
    },
  });
  console.log("EXPIRED invite link:");
  console.log(`  http://localhost:3000/invite/${expired.plaintext}`);

  console.log("\nUsers:");
  console.log(`  OWNER  ${ownerEmail}`);
  console.log(`  MEMBER ${memberEmail}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
