"use client";

import { useEffect, useRef } from "react";
import { approach, useFinePointer, useReducedMotion } from "@/components/landing/motion";

/**
 * The landing's lens, as a centrepiece for the quiet pages (404, offline): a huge condensed glyph drawn as an
 * outline, and a disc of glass that shows it solid underneath. The glass drifts toward the pointer on
 * desktop and rests in place everywhere else. Decorative: the page's heading says what happened.
 */
export function LensGlyph({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fine = useFinePointer();
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !fine || reduced) return;
    const cur = { x: 0.5, y: 0.5 };
    const target = { x: 0.5, y: 0.5 };
    let frame = 0;
    let last = 0;
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      cur.x = approach(cur.x, target.x, 0.08, dt);
      cur.y = approach(cur.y, target.y, 0.08, dt);
      el.style.setProperty("--gx", `${(cur.x * 100).toFixed(2)}%`);
      el.style.setProperty("--gy", `${(cur.y * 100).toFixed(2)}%`);
      frame = Math.abs(cur.x - target.x) + Math.abs(cur.y - target.y) > 0.001 ? requestAnimationFrame(step) : 0;
    };
    const onMove = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      // Follow the hand loosely, but keep the glass mostly over the glyph.
      target.x = Math.min(0.85, Math.max(0.15, (e.clientX - b.left) / b.width));
      target.y = Math.min(0.8, Math.max(0.2, (e.clientY - b.top) / b.height));
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [fine, reduced]);

  const type = "font-heading text-[clamp(8rem,30vw,17rem)] leading-[0.85] font-extrabold tracking-[-0.02em] [font-stretch:58%] select-none";
  return (
    <div ref={ref} aria-hidden className="relative mx-auto w-fit [--gx:50%] [--gy:50%] [--r:clamp(4.5rem,13vw,7.5rem)]">
      <p className={`${type} text-transparent [-webkit-text-stroke:1.5px_color-mix(in_oklch,var(--foreground)_35%,transparent)]`}>{text}</p>
      <p className={`${type} absolute inset-0 text-primary [clip-path:circle(var(--r)_at_var(--gx)_var(--gy))]`}>{text}</p>
      <span
        className="tb-glass pointer-events-none absolute size-[calc(var(--r)*2)] rounded-full"
        // Physical left on purpose: the pointer maths is physical in LTR and RTL alike.
        style={{ left: "calc(var(--gx) - var(--r))", top: "calc(var(--gy) - var(--r))" }}
      />
    </div>
  );
}
