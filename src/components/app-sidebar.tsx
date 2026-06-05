"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  LayoutDashboard,
  Lightbulb,
  Receipt,
  Settings,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

type Role = "OWNER" | "ADMIN" | "MEMBER";

type AppSidebarUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: Role;
} | null;

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

const baseItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Insights", href: "/insights", icon: Lightbulb },
  { label: "Subscriptions", href: "/subscriptions", icon: CreditCard },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Settings", href: "/settings", icon: Settings },
];

const adminItem: NavItem = {
  label: "Users",
  href: "/admin/users",
  icon: Users,
  adminOnly: true,
};

export function AppSidebar({ user }: { user?: AppSidebarUser }) {
  const pathname = usePathname();
  const isAdmin = user?.role === "OWNER" || user?.role === "ADMIN";
  const items = isAdmin ? [...baseItems, adminItem] : baseItems;

  return (
    <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:border-r md:bg-sidebar md:text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[12px] font-bold tracking-tight text-brand-foreground">
          S
        </span>
        <span className="text-sm font-semibold tracking-tight">Sub-Tracker</span>
      </div>
      <nav className="flex-1 space-y-1 px-2 py-3">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-brand-soft text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {user ? (
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          <div className="truncate font-medium text-foreground">
            {user.name || user.email || "Signed in"}
          </div>
          <div className="truncate">{user.email}</div>
          <div className="mt-1 inline-flex rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">
            {user.role}
          </div>
        </div>
      ) : (
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
          v0.1.0
        </div>
      )}
    </aside>
  );
}
