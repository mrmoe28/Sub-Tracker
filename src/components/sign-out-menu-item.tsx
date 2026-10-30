"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function SignOutMenuItem() {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        void signOut({ callbackUrl: "/" });
      }}
    >
      <LogOut className="mr-2 h-4 w-4" />
      Sign out
    </DropdownMenuItem>
  );
}
