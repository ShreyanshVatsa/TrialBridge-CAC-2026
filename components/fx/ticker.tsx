"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/components/landing/motion";
import { cn } from "@/lib/utils";

const DIGITS = "0123456789";

/**
 * A formatted number ("1,234", "37%") whose digits roll on reels to each new value, like a mechanical
 * counter. Starts from zero the first time it scrolls into view. Only ASCII digits roll; separators and
 * other numerals (for example Arabic-Indic) are set as they are. Screen readers get the plain value.
 */
export function Ticker({ value, className }: { value: string; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  if (reduced) return <span className={cn("tabular-nums", className)}>{value}</span>;

  const chars = Array.from(value);
  return (
    <span ref={ref} dir="ltr" className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{value}</span>
      <span aria-hidden className="inline-flex leading-none">
        {chars.map((ch, i) => {
          // Keyed from the right so "999" -> "1,000" keeps the ones column rolling in place.
          const key = chars.length - i;
          const d = DIGITS.indexOf(ch);
          if (d < 0)
            return (
              <span key={`c${key}`} className="inline-block h-[1em] leading-none">
                {ch}
              </span>
            );
          return (
            <span key={`d${key}`} className="relative inline-block h-[1em] overflow-hidden leading-none">
              <span className="invisible">0</span>
              <span
                className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ transform: `translateY(-${(seen ? d : 0) * 10}%)`, transitionDelay: `${Math.min(key, 6) * 45}ms` }}
              >
                {Array.from(DIGITS).map((x) => (
                  <span key={x} className="block h-[1em] text-center leading-none">
                    {x}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
