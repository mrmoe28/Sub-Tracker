import "server-only";

import { auth } from "@/auth";

import { prisma } from "./prisma";

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export async function getCurrentUser() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new AuthRequiredError();

  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
  });
}
