"use client";

import { AlertTriangle, CircleCheck, MapPin } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useMessages } from "@/components/i18n";
import { LogoMark } from "@/components/site/logo";
import { TypingDots } from "@/components/site/spinner";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "./motion";

const STEPS = 7; // q1, a1, q2, a2, searching, card, hold
const STEP_MS = 1300;

/** Scroll-driven stage -> last step to show: 0 = the chat, 1 = searching, 2 = the result card. */
const STAGE_END = [3, 4, 5] as const;

function Reveal({ show, children, className }: { show: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "origin-bottom transition-transform duration-500 ease-out motion-reduce:transition-none",
        show ? "visible translate-y-0 scale-100" : "invisible translate-y-2 scale-95",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Animated product preview built in code. Illustrative content only; not a real trial.
 * Without `stage` it loops on a timer. With `stage` (driven by scroll position) it plays forward to that
 * stage one message at a time, and rewinds straight to it when the reader scrolls back up.
 */
export function LandingDemo({ stage }: { stage?: 0 | 1 | 2 }) {
  const m = useMessages();
  const reduced = useReducedMotion();
  const [tick, setTick] = useState(0);
  const end = stage === undefined ? undefined : STAGE_END[stage];

  useEffect(() => {
    if (reduced || end !== undefined) return;
    const id = setInterval(() => setTick((t) => (t + 1) % (STEPS + 1)), STEP_MS);
    return () => clearInterval(id);
  }, [reduced, end]);

  useEffect(() => {
    if (reduced || end === undefined) return;
    const id = setInterval(() => setTick((t) => (t < end ? t + 1 : end)), 520);
    return () => clearInterval(id);
  }, [reduced, end]);

  const step = reduced ? (end ?? STEPS) : end !== undefined ? Math.min(tick, end) : tick;
  const searching = step === 4;

  return (
    <div role="img" aria-label={m.landing.demoLabel} className="relative mx-auto w-full max-w-[23.5rem]">
      {/* A phone, drawn in CSS: metal band, black glass bezel, island, and a faint glare across the screen. */}
      <div aria-hidden className="tb-device relative rounded-[3.25rem] p-[0.7rem]">
        <div className="relative overflow-hidden rounded-[2.6rem] bg-card px-4 pt-12 pb-6 ring-1 ring-black/60">
        <span className="absolute inset-x-0 top-3 mx-auto h-7 w-[6.5rem] rounded-full bg-black" />
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LogoMark className="size-6" />
            TrialBridge
          </div>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{m.landing.demoTag}</span>
        </div>
        <div className="flex min-h-[25rem] flex-col gap-3 text-[0.95rem]">
          <Reveal show={step >= 0} className="max-w-[85%] rounded-2xl rounded-es-md bg-bubble px-3.5 py-2.5">
            {m.landing.demoQ1}
          </Reveal>
          <Reveal show={step >= 1} className="ms-auto rounded-2xl rounded-ee-md bg-primary px-3.5 py-2.5 text-primary-foreground">
            {m.landing.demoA1}
          </Reveal>
          <Reveal show={step >= 2} className="max-w-[85%] rounded-2xl rounded-es-md bg-bubble px-3.5 py-2.5">
            {m.landing.demoQ2}
          </Reveal>
          <Reveal show={step >= 3} className="ms-auto rounded-2xl rounded-ee-md bg-primary px-3.5 py-2.5 text-primary-foreground">
            {m.landing.demoA2}
          </Reveal>
          <Reveal show={searching} className="flex h-5 items-center gap-2 text-sm text-muted-foreground">
            <TypingDots label="" className="text-primary" />
            {m.landing.demoSearching}
          </Reveal>
          <Reveal show={step >= 5} className="rounded-2xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-secondary px-2 py-0.5 font-medium text-secondary-foreground">
                <CircleCheck className="size-3.5" />
                {m.landing.demoFit}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-warn-border bg-warn px-2 py-0.5 font-medium text-warn-foreground">
                <AlertTriangle className="size-3.5" />
                {m.landing.demoBarrier}
              </span>
            </div>
            <p className="mt-2 font-heading text-xl leading-tight font-bold [font-stretch:82%]">{m.landing.demoCardTitle}</p>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" />
              {m.landing.demoCardMeta}
            </p>
            <p className="mt-3 text-sm font-semibold text-success-foreground">{m.landing.demoWhy}</p>
            <p className="mt-1 border-s-2 border-primary/50 ps-2.5 text-sm italic">{m.landing.demoQuote}</p>
          </Reveal>
        </div>
        <span className="pointer-events-none absolute inset-0 rounded-[2.6rem] bg-[linear-gradient(115deg,oklch(1_0_0/0.09),transparent_30%,transparent_70%,oklch(1_0_0/0.03))]" />
        </div>
      </div>
    </div>
  );
}
