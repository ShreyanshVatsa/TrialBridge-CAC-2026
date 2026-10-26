"use client";

import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useFinePointer, useReducedMotion } from "./motion";

/**
 * Leans its child toward the pointer while the pointer is near, then springs back on leave.
 * Mouse only and off under reduced motion; the child stays a normal link or button either way.
 */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const on = fine && !reduced;

  const move = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const dx = (e.clientX - (b.left + b.width / 2)) * strength;
    const dy = (e.clientY - (b.top + b.height / 2)) * strength;
    el.style.transition = "transform 120ms ease-out";
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "transform 600ms cubic-bezier(0.2, 1.6, 0.4, 1)";
    el.style.transform = "";
  };

  return (
    <span
      ref={ref}
      onPointerMove={on ? move : undefined}
      onPointerLeave={on ? leave : undefined}
      className={cn("inline-block will-change-transform", className)}
    >
      {children}
    </span>
  );
}
