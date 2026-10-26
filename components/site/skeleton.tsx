import { cn } from "@/lib/utils";

/** Placeholder block shaped like the content it stands in for; a slow sweep of light runs only when motion is allowed. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("tb-shimmer rounded-lg bg-muted motion-reduce:animate-none", className)} />;
}
