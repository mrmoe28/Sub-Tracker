import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "@/lib/prisma";

const emailIsInviteValid = async (email: string | null | undefined) => {
  if (!email) return false;
  const now = new Date();
  const invite = await prisma.invite.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
  return invite !== null;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  pages: {
    signIn: "/",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
      authorization: {
        params: {
          prompt: "select_account",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const candidate = user?.email ?? null;
      if (!candidate) return false;

      const lower = candidate.toLowerCase();

      // 1. Bootstrap: the very first user is allowed in and promoted to OWNER
      //    via the `signIn` event below.
      const totalUsers = await prisma.user.count();
      if (totalUsers <= 1) {
        // Either there are zero users (bootstrap) or there's a single
        // existing OWNER — allow them back in. We only block once a User
        // row exists but no invite matches.
      } else {
        // 2. Existing user: must already have a row in the User table.
        const existing = await prisma.user.findUnique({
          where: { email: lower },
        });
        if (existing) return true;

        // 3. New user: must have a valid (unrevoked, unexpired) Invite.
        const ok = await emailIsInviteValid(lower);
        if (!ok) return false;
      }

      return true;
    },
    session({ session, user }) {
      if (session.user) {
        const u = session.user as typeof session.user & {
          id: string;
          role?: "OWNER" | "ADMIN" | "MEMBER";
        };
        u.id = user.id;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, isNewUser }) {
      // Promote the first user to OWNER on their first sign-in.
      if (!isNewUser) return;
      const total = await prisma.user.count();
      if (total !== 1) return;
      const email = user.email?.toLowerCase();
      if (!email) return;
      await prisma.user.update({
        where: { email },
        data: { role: "OWNER" },
      });
    },
  },
});
