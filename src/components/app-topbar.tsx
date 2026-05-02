import Link from "next/link";
import { User } from "lucide-react";

import { SignOutButton } from "@/components/auth-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCurrentUser } from "@/lib/current-user";

function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "User";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export async function AppTopbar() {
  const user = await getCurrentUser();

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b bg-background px-4 md:px-6">
      <div className="text-sm text-muted-foreground">Overview</div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-full">
            <Avatar>
              <AvatarFallback>{initials(user.name, user.email)}</AvatarFallback>
            </Avatar>
            <span className="sr-only">Open user menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>
            <div className="truncate">{user.name ?? "Account"}</div>
            <div className="truncate text-xs font-normal text-muted-foreground">
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <User className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <SignOutButton />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
