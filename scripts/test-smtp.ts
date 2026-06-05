// Sends a test email through the configured Gmail SMTP transport.
//
// Run with: npx tsx scripts/test-smtp.ts <to-address>
//
// Reads GMAIL_USER / GMAIL_APP_PASSWORD / GMAIL_FROM_NAME from the
// environment. Exits non-zero if the transport is misconfigured or the
// send fails.

import nodemailer from "nodemailer";

async function main() {
  const to = process.argv[2];
  if (!to) {
    console.error("Usage: tsx scripts/test-smtp.ts <to-address>");
    process.exit(2);
  }

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error("GMAIL_USER and GMAIL_APP_PASSWORD must be set in the environment.");
    process.exit(2);
  }

  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user, pass },
  });

  const fromName = process.env.GMAIL_FROM_NAME ?? "Sub-Tracker";
  const info = await transport.sendMail({
    from: `"${fromName}" <${user}>`,
    to,
    subject: `${fromName} SMTP test`,
    text: [
      "This is a test email from the Sub-Tracker local dev environment.",
      "",
      "If you got this, Gmail SMTP is wired up correctly.",
    ].join("\n"),
  });

  console.log("Sent. messageId:", info.messageId);
  const preview = nodemailer.getTestMessageUrl(info);
  if (preview) console.log("Preview URL:", preview);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
