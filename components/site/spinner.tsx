import { cn } from "@/lib/utils";

/** Three-dot typing / loading indicator. Screen readers get `label` via a visually hidden span. */
export function TypingDots({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role={label ? "status" : undefined} aria-hidden={label ? undefined : true}>
      {label && <span className="sr-only">{label}</span>}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="animate-typing-dot size-1.5 rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
