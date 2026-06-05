import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

let cached: Transporter | null = null;

function getTransport(): Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  if (!cached) {
    cached = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user, pass },
    });
  }
  return cached;
}

export type SendInviteEmailInput = {
  to: string;
  inviteUrl: string;
  inviterName?: string | null;
  inviterEmail?: string | null;
};

export type SendInviteEmailResult =
  | { ok: true; messageId: string; previewUrl: string | null }
  | { ok: false; error: string; previewUrl: string | null };

/**
 * Sends an invite email. When SMTP env vars are not configured, this
 * short-circuits and returns the would-be URL as `previewUrl` so the
 * action can still expose the link to the admin.
 */
export async function sendInviteEmail(
  input: SendInviteEmailInput,
): Promise<SendInviteEmailResult> {
  const fromName = process.env.GMAIL_FROM_NAME ?? "Sub-Tracker";
  const fromAddr = process.env.GMAIL_USER;
  const transport = getTransport();

  const subject = `${fromName}: you've been invited`;
  const text = [
    input.inviterName
      ? `${input.inviterName} (${input.inviterEmail ?? ""}) invited you to ${fromName}.`
      : `You've been invited to ${fromName}.`,
    "",
    "Click the link below to accept the invite and sign in. The link is good for 7 days:",
    input.inviteUrl,
    "",
    "If you weren't expecting this email, you can ignore it.",
  ].join("\n");

  if (!transport || !fromAddr) {
    return { ok: false, error: "smtp_not_configured", previewUrl: input.inviteUrl };
  }

  try {
    const info = await transport.sendMail({
      from: `"${fromName}" <${fromAddr}>`,
      to: input.to,
      subject,
      text,
    });
    const preview = nodemailer.getTestMessageUrl(info);
    return {
      ok: true,
      messageId: info.messageId,
      previewUrl: typeof preview === "string" ? preview : null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      previewUrl: null,
    };
  }
}
