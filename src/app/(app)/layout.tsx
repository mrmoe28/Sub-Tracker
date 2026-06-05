import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/");

  const sessionUser = session.user as
    | (typeof session.user & { id: string; role?: "OWNER" | "ADMIN" | "MEMBER" })
    | undefined;

  // The Auth.js session callback above only attaches `id`; load the
  // role fresh from the DB so role changes take effect without re-login.
  const user = sessionUser?.id
    ? await prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, name: true, email: true, image: true, role: true },
      })
    : null;

  return (
    <div className="flex min-h-svh">
      <AppSidebar
        user={
          user
            ? {
                id: user.id,
                name: user.name,
                email: user.email,
                image: user.image,
                role: user.role,
              }
            : null
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
