"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useMessages } from "@/components/i18n";
import { cn } from "@/lib/utils";
import { useReducedMotion, useWide } from "./motion";

// The animated demo is decorative: load it after first paint, in a same-size frame (no layout shift).
const LandingDemo = dynamic(() => import("./demo").then((x) => x.LandingDemo), {
  ssr: false,
  loading: () => <div aria-hidden className="mx-auto h-[36.5rem] max-w-[23.5rem] rounded-[3.25rem] bg-card" />,
});

/**
 * Three steps beside a pinned product demo. On wide screens the step in the middle of the viewport drives
 * the demo, so reading down the page plays the conversation. Narrow screens get the demo on its own loop.
 */
export function HowItWorks() {
  const m = useMessages().landing;
  const wide = useWide();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const items = useRef<(HTMLLIElement | null)[]>([]);
  const sectionRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // Two scroll-linked values, written as CSS variables: --read fills the rail beside the steps up to the
  // middle of the viewport, --lift settles the phone from tilted to upright as it comes into view.
  useEffect(() => {
    const section = sectionRef.current;
    const rail = railRef.current;
    if (!section || !rail || reduced) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const vh = window.innerHeight;
      const l = rail.getBoundingClientRect();
      const s = section.getBoundingClientRect();
      const clamp = (x: number) => Math.min(1, Math.max(0, x));
      // The fill ends at the middle of the viewport, the same line that picks the active step.
      rail.style.setProperty("--read", clamp((vh * 0.5 - l.top) / Math.max(1, l.height)).toFixed(4));
      section.style.setProperty("--lift", clamp((vh - s.top) / (vh * 0.8)).toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [reduced]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    items.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section ref={sectionRef} aria-labelledby="how-title" className="[--lift:1] [--read:1] mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32">
      <h2 id="how-title" className="text-[clamp(2.75rem,7vw,6rem)] font-extrabold tracking-[-0.02em] [font-stretch:62%]">
        {m.howTitle}
      </h2>
      <div className="mt-12 grid gap-12 lg:mt-4 lg:grid-cols-[1fr_minmax(0,28rem)] lg:gap-20">
        <div className="relative order-2 lg:order-1 lg:ps-10">
          {/* Reading rail from the first step to the last: fills with your position, wide screens only. */}
          <div ref={railRef} aria-hidden className="absolute inset-y-[26svh] start-0 hidden w-px bg-foreground/15 lg:block">
            <span className="absolute inset-0 origin-top scale-y-(--read) bg-primary" />
            <span className="absolute start-1/2 top-[calc(var(--read)*100%)] size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_5px_var(--background)] rtl:translate-x-1/2" />
          </div>
          <ol>
          {m.how.map((step, i) => (
            <li
              key={step.title}
              ref={(el) => {
                items.current[i] = el;
              }}
              data-i={i}
              className="grid grid-cols-[auto_1fr] gap-x-6 border-t border-foreground/15 py-8 lg:min-h-[52svh] lg:items-center lg:border-0 lg:py-0"
            >
              <span
                aria-hidden
                className={cn(
                  "font-heading text-[clamp(4rem,9vw,8rem)] leading-[0.8] font-extrabold [font-stretch:56%] transition-colors duration-500",
                  wide && active !== i ? "text-foreground/12" : "text-primary",
                )}
              >
                {i + 1}
              </span>
              <div className={cn("transition-opacity duration-500", wide && active !== i && "opacity-90")}>
                <h3 className="text-3xl font-bold [font-stretch:72%] sm:text-4xl">{step.title}</h3>
                <p className="mt-3 max-w-[44ch] text-lg text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
          </ol>
        </div>
        <div className="order-1 lg:order-2">
          <div
            className="lg:sticky lg:top-[calc(50svh-17.5rem)] [transform:perspective(1400px)_translateY(calc((1-var(--lift))*3rem))_rotateX(calc((1-var(--lift))*14deg))_scale(calc(0.94+var(--lift)*0.06))] [transform-origin:50%_100%]"
          >
            <LandingDemo stage={wide ? (active as 0 | 1 | 2) : undefined} />
          </div>
        </div>
      </div>
    </section>
  );
}
