"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { resendInviteAction } from "../_lib/actions";
import { initialActionState, type ActionState as InviteActionState } from "../_lib/state";

export function ResendInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction, pending] = useActionState<InviteActionState, FormData>(
    resendInviteAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={inviteId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Sending…" : "Resend"}
      </Button>
      {state.message ? (
        <span
          className={
            "max-w-[18rem] text-right text-[10px] " +
            (state.ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive")
          }
        >
          {state.message}
          {state.ok && state.inviteUrl ? (
            <>
              {" "}
              <a
                href={state.inviteUrl}
                className="underline"
                target="_blank"
                rel="noreferrer"
              >
                Open link
              </a>
            </>
          ) : null}
        </span>
      ) : null}
    </form>
  );
}
