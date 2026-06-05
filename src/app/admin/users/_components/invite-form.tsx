"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createInviteAction } from "../_lib/actions";
import { initialActionState, type ActionState } from "../_lib/state";

export function InviteForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createInviteAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          placeholder="person@example.com"
          autoComplete="off"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Send invite"}
      </Button>
      {state.message ? (
        <p
          className={
            state.ok
              ? "text-xs text-emerald-600 dark:text-emerald-400"
              : "text-xs text-destructive"
          }
        >
          {state.message}
        </p>
      ) : null}
      {state.ok && state.inviteUrl ? (
        <div className="space-y-1 rounded-md border bg-muted/50 p-3 text-xs">
          <div className="font-medium">Share this invite link</div>
          <code className="block break-all rounded bg-background p-2 text-[11px]">
            {state.inviteUrl}
          </code>
          <div className="text-muted-foreground">
            The link expires in 7 days.
          </div>
        </div>
      ) : null}
    </form>
  );
}
