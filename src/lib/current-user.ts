import "server-only";

import { prisma } from "./prisma";

// TODO: replace with real auth. Until then, every request operates as
// the same demo user so the rest of the app can be built end-to-end.
//
// SECURITY: this stub means there is NO data isolation between users —
// every browser session resolves to the same row. We therefore fail-closed
// in production unless explicitly opted in via ALLOW_DEMO_USER=true, so
// nobody accidentally ships this to a multi-user environment.
const DEMO_EMAIL = "demo@sub-tracker.local";

export async function getCurrentUser() {
  if (process.env.NODE_ENV === "production") {
    if (process.env.ALLOW_DEMO_USER !== "true") {
      throw new Error(
        "Demo-user auth stub is disabled in production. Implement real auth, " +
          "or set ALLOW_DEMO_USER=true to explicitly opt in.",
      );
    }
  }

  return prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Demo User" },
  });
}
