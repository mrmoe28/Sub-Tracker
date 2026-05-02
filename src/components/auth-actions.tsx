import { LogIn, LogOut } from "lucide-react";

import { signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export function SignInWithGoogleButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", { redirectTo: "/dashboard" });
      }}
    >
      <Button type="submit" className="w-full">
        <LogIn />
        Continue with Google
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="flex w-full items-center px-2 py-1.5 text-sm"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sign out
      </button>
    </form>
  );
}
