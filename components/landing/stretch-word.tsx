"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { approach, useFinePointer, useReducedMotion } from "./motion";

const BASE = 62;
const PEAK = 120;
/** Narrowest the font allows. Letters away from the pointer condense toward it to pay for the wide ones. */
const MIN = 50;

/**
 * A word set in Anybody whose letters widen on the font's width axis as the pointer passes over them,
 * like a hand pressing on type. Decorative: the word is still read once, as plain text.
 */
export function StretchWord({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const on = fine && !reduced;
  const state = useRef({ px: -1e4, centers: [] as number[], cur: [] as number[], frame: 0, last: 0, inside: false });
  const letters = Array.from(text);

  useEffect(() => {
    const s = state.current;
    return () => cancelAnimationFrame(s.frame);
  }, []);

  const spans = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-l]") ?? []);

  const loop = (now: number) => {
    const s = state.current;
    const dt = Math.min(64, now - s.last);
    s.last = now;
    const els = spans();
    const sigma = (ref.current?.clientWidth ?? 1000) / 9;
    let moving = false;
    const raw = els.map((_, i) => {
      const d = s.inside ? s.px - (s.centers[i] ?? 0) : 1e4;
      return BASE + (PEAK - BASE) * Math.exp(-((d / sigma) ** 2));
    });
    // Keep the word's total width constant (width tracks the stretch axis closely enough), so it never overflows.
    const k = (els.length * (BASE - MIN)) / raw.reduce((a, w) => a + (w - MIN), 0);
    els.forEach((el, i) => {
      const want = MIN + (raw[i]! - MIN) * k;
      const next = approach(s.cur[i] ?? BASE, want, 0.16, dt);
      if (Math.abs(next - want) > 0.2) moving = true;
      s.cur[i] = next;
      el.style.fontStretch = `${next.toFixed(1)}%`;
      el.style.fontWeight = String(Math.round(Math.max(600, 700 + (next - BASE) * 4)));
    });
    s.frame = moving ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => {
    const s = state.current;
    if (s.frame) return;
    s.last = performance.now();
    s.frame = requestAnimationFrame(loop);
  };

  return (
    <span
      ref={ref}
      aria-hidden
      onPointerEnter={
        on
          ? () => {
              // Measure resting letter centres once per visit, so the effect doesn't chase its own widening.
              const s = state.current;
              if (!s.frame) s.centers = spans().map((el) => el.getBoundingClientRect().left + el.offsetWidth / 2);
              s.inside = true;
            }
          : undefined
      }
      onPointerMove={
        on
          ? (e) => {
              state.current.px = e.clientX;
              kick();
            }
          : undefined
      }
      onPointerLeave={
        on
          ? () => {
              state.current.inside = false;
              kick();
            }
          : undefined
      }
      className={cn("flex w-fit font-heading leading-[0.8] font-bold whitespace-nowrap", className)}
      style={{ fontStretch: `${BASE}%` }}
    >
      {letters.map((ch, i) => (
        <span key={i} data-l style={{ fontStretch: `${BASE}%` }}>
          {ch}
        </span>
      ))}
    </span>
  );
}
