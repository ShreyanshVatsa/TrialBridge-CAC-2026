"use client";

import { Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "@/components/site/logo";

export function AssistantBubble({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="animate-enter flex items-end gap-2.5">
      <LogoMark className="mb-0.5 size-7 drop-shadow-[0_4px_8px_oklch(0.45_0.2_285/0.35)]" />
      <div className="max-w-[85%] rounded-3xl rounded-es-md border border-border/70 bg-bubble px-4 py-3 text-foreground shadow-[var(--rim),var(--shadow-1)]">
        <span className="sr-only">{label}: </span>
        {children}
      </div>
    </div>
  );
}

export function UserBubble({
  children,
  label,
  onEdit,
  editLabel,
}: {
  children: ReactNode;
  label: string;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="animate-enter flex items-center justify-end gap-1.5">
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          title={editLabel}
          className="inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-4" aria-hidden />
        </button>
      )}
      <div className="max-w-[80%] rounded-3xl rounded-ee-md bg-primary bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary),white_12%),var(--primary)_70%)] px-4 py-3 text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.25),0_10px_20px_-12px_var(--iris)]">
        <span className="sr-only">{label}: </span>
        {children}
      </div>
    </div>
  );
}

export const inputClass =
  "h-12 w-full rounded-2xl border border-input bg-card px-4 text-base text-foreground shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.08)] transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-primary/40 focus-visible:border-ring focus-visible:shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.08),0_0_0_4px_color-mix(in_oklch,var(--ring)_18%,transparent)] focus-visible:outline-2 focus-visible:outline-ring aria-[invalid=true]:border-destructive";
