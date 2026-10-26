"use client";

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Editorial page head shared by the inner pages: an eyebrow, a condensed display title whose words settle
 * into place (the landing's load moment), and a lead paragraph. A quiet lavender
 * bloom sits behind it; never a pattern, so the text always reads against flat colour.
 */
export function PageHead({
  title,
  intro,
  eyebrow,
  children,
  className,
  size = "lg",
  titleRef,
}: {
  title: string;
  intro?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  className?: string;
  size?: "lg" | "md";
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <header className={cn("relative", className)}>
      <div aria-hidden className="tb-head-bloom" />
      {eyebrow && <p className="mb-4 text-sm font-semibold tracking-[0.08em] text-primary uppercase">{eyebrow}</p>}
      <h1
        ref={titleRef}
        tabIndex={titleRef ? -1 : undefined}
        className={cn("tb-display outline-none", size === "lg" ? "text-[clamp(2.4rem,7vw,6rem)]" : "text-[clamp(2.25rem,5vw,4rem)]")}
      >
        {title.split(" ").map((word, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            <span className="inline-block pb-[0.1em] align-bottom">
              <span className="inline-block animate-rise" style={{ animationDelay: `${i * 30}ms` }}>
                {word}
              </span>
            </span>
          </Fragment>
        ))}
      </h1>
      {intro && <div className="mt-5 max-w-[60ch] text-lg text-muted-foreground sm:text-xl">{intro}</div>}
      {children}
    </header>
  );
}
