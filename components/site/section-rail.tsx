"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/landing/motion";
import { cn } from "@/lib/utils";

interface RailItem {
  id: string;
  label: string;
}

/**
 * Sticky "on this page" rail for long pages (wide screens): a hairline that fills as you read, with the
 * section in view marked. Same reading line as the landing's How it works. Plain anchor links, so it works
 * without JavaScript and by keyboard; the fill is decoration.
 */
export function SectionRail({ items, label, className }: { items: readonly RailItem[]; label: string; className?: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const lineRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => x !== null);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));

    let frame = 0;
    const read = () => {
      frame = 0;
      const first = els[0]!.getBoundingClientRect();
      const last = els[els.length - 1]!.getBoundingClientRect();
      const span = Math.max(1, last.bottom - first.top);
      const f = Math.min(1, Math.max(0, (window.innerHeight * 0.35 - first.top) / span));
      lineRef.current?.style.setProperty("--read", f.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [items]);

  return (
    <nav aria-label={label} className={cn("no-print sticky top-28 hidden self-start lg:block", className)}>
      <div className="relative ps-5">
        <div ref={lineRef} aria-hidden className="absolute inset-y-1 start-0 w-px bg-foreground/12 [--read:0]">
          <span className={cn("absolute inset-0 origin-top scale-y-(--read) bg-primary", !reduced && "transition-transform duration-300 ease-out")} />
        </div>
        <ol className="space-y-1">
          {items.map((it, i) => {
            const on = it.id === active;
            return (
              <li key={it.id}>
                <a
                  href={`#${it.id}`}
                  aria-current={on ? "location" : undefined}
                  className={cn(
                    "group flex items-baseline gap-3 rounded-lg py-1.5 text-[0.95rem] leading-snug transition-colors",
                    on ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span aria-hidden className={cn("font-heading text-sm font-bold tabular-nums [font-stretch:70%]", on ? "text-primary" : "text-muted-foreground")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={cn("transition-transform duration-300", on && "motion-safe:translate-x-0.5 rtl:motion-safe:-translate-x-0.5")}>{it.label}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
