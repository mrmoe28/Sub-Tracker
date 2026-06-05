// Shared shape and initial value for useActionState across the admin
// users page. Lives in its own file so the `"use server"` actions
// module doesn't pull client state types into the server boundary.
export type ActionState = {
  ok: boolean;
  message: string;
  inviteUrl?: string;
  inviteEmail?: string;
};

export const initialActionState: ActionState = { ok: false, message: "" };
