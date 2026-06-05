"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, AuthRequiredError } from "@/lib/current-user";
import { sendInviteEmail } from "@/lib/email";
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiresAt,
} from "@/lib/invite-token";
import { prisma } from "@/lib/prisma";

import { initialActionState, type ActionState } from "./state";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function originFromRequest(): string {
  // Prefer AUTH_URL (production), fall back to request host (dev).
  const fromEnv = process.env.AUTH_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return "http://localhost:3000";
}

async function requireAdmin() {
  try {
    const me = await getCurrentUser();
    if (me.role !== "OWNER" && me.role !== "ADMIN") {
      return { error: "forbidden" as const };
    }
    return { me };
  } catch (err) {
    if (err instanceof AuthRequiredError) return { error: "unauthorized" as const };
    throw err;
  }
}

export async function createInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    if (auth.error === "unauthorized") {
      return { ok: false, message: "You must be signed in." };
    }
    return { ok: false, message: "You don't have permission to invite users." };
  }
  const { me } = auth;

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, message: `${email} is already a member.` };
  }

  await prisma.invite.deleteMany({
    where: { email, revokedAt: null },
  });

  const { plaintext, hash } = generateInviteToken();
  const expiresAt = inviteExpiresAt();

  await prisma.invite.create({
    data: {
      email,
      tokenHash: hash,
      invitedById: me.id,
      expiresAt,
    },
  });

  const inviteUrl = `${originFromRequest()}/invite/${plaintext}`;
  const send = await sendInviteEmail({
    to: email,
    inviteUrl,
    inviterName: me.name,
    inviterEmail: me.email,
  });

  revalidatePath("/admin/users");

  if (send.ok) {
    return {
      ok: true,
      message: `Invite emailed to ${email}.`,
      inviteEmail: email,
    };
  }
  if (send.error === "smtp_not_configured") {
    return {
      ok: true,
      message: `Invite created. SMTP isn't configured — share this link manually.`,
      inviteUrl,
      inviteEmail: email,
    };
  }
  return {
    ok: false,
    message: `Invite created but email failed: ${send.error}`,
    inviteUrl,
    inviteEmail: email,
  };
}

export async function revokeInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return { ok: false, message: "Not allowed." };
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing invite id." };

  await prisma.invite.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "Invite revoked." };
}

export async function resendInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return { ok: false, message: "Not allowed." };
  }
  const { me } = auth;
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing invite id." };

  const existing = await prisma.invite.findUnique({ where: { id } });
  if (!existing) return { ok: false, message: "Invite not found." };
  if (existing.revokedAt) return { ok: false, message: "Invite is revoked." };
  if (existing.expiresAt < new Date()) {
    return { ok: false, message: "Invite has expired. Create a new one." };
  }

  const { plaintext, hash } = generateInviteToken();
  await prisma.invite.update({
    where: { id: existing.id },
    data: { tokenHash: hash, expiresAt: inviteExpiresAt() },
  });

  const inviteUrl = `${originFromRequest()}/invite/${plaintext}`;
  const send = await sendInviteEmail({
    to: existing.email,
    inviteUrl,
    inviterName: me.name,
    inviterEmail: me.email,
  });

  revalidatePath("/admin/users");

  if (send.ok) {
    return { ok: true, message: `Re-sent invite to ${existing.email}.` };
  }
  if (send.error === "smtp_not_configured") {
    return {
      ok: true,
      message: "Invite rotated. SMTP not configured — share the link manually.",
      inviteUrl,
      inviteEmail: existing.email,
    };
  }
  return {
    ok: false,
    message: `Could not resend: ${send.error}`,
  };
}

export async function changeRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return { ok: false, message: "Not allowed." };
  }
  const { me } = auth;

  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!id || !["OWNER", "ADMIN", "MEMBER"].includes(role)) {
    return { ok: false, message: "Invalid input." };
  }

  if (id === me.id && role !== "OWNER") {
    return {
      ok: false,
      message: "You can't demote yourself. Promote another OWNER first.",
    };
  }

  if (role !== "OWNER") {
    const target = await prisma.user.findUnique({ where: { id } });
    if (target?.role === "OWNER") {
      const ownerCount = await prisma.user.count({ where: { role: "OWNER" } });
      if (ownerCount <= 1) {
        return {
          ok: false,
          message: "At least one OWNER is required. Promote someone else first.",
        };
      }
    }
  }

  await prisma.user.update({
    where: { id },
    data: { role: role as "OWNER" | "ADMIN" | "MEMBER" },
  });

  revalidatePath("/admin/users");
  return { ok: true, message: "Role updated." };
}

// Silence "unused" for the helper that's only used in token-rotation paths.
void hashInviteToken;
void initialActionState;
