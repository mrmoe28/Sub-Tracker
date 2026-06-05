"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function FormSubmitButton({
  variant = "ghost",
  size = "sm",
  pendingLabel,
  idleLabel,
}: {
  variant?: "ghost" | "default" | "destructive" | "outline" | "secondary" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  pendingLabel: string;
  idleLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
