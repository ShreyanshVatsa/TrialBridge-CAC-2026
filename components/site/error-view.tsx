"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useMessages } from "@/components/i18n";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Friendly error panel used by route error boundaries and failed loads. Never shows stack traces. */
export function ErrorView({
  title,
  body,
  onRetry,
  showHome = true,
  className,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
  showHome?: boolean;
  className?: string;
}) {
  const m = useMessages();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div role="alert" className={cn("tb-surface animate-enter mx-auto max-w-xl rounded-3xl p-7 text-center sm:p-10", className)}>
      <span aria-hidden className="mx-auto mb-5 inline-flex size-14 items-center justify-center rounded-2xl border border-warn-border bg-warn text-warn-foreground shadow-[var(--rim),0_10px_22px_-12px_oklch(0.6_0.12_60)]">
        <AlertTriangle className="size-7" />
      </span>
      <h2 ref={ref} tabIndex={-1} className="text-[clamp(1.875rem,4vw,2.5rem)] leading-[1.02] font-bold text-balance [font-stretch:70%] outline-none">
        {title ?? m.errors.title}
      </h2>
      <p className="mt-2 text-muted-foreground">{body ?? m.errors.body}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {onRetry && (
          <Button size="lg" onClick={onRetry}>
            {m.common.retry}
          </Button>
        )}
        {showHome && (
          <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
            {m.common.home}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Shared body for every route error.tsx boundary. */
export function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="relative flex flex-1 items-center px-4 py-20">
      <div aria-hidden className="tb-ambient pointer-events-none absolute inset-x-0 -top-40 -z-10 h-[34rem] [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
      <ErrorView onRetry={reset} className="w-full" />
    </main>
  );
}
