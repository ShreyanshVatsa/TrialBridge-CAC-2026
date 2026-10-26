"use client";

import { useEffect, useRef } from "react";
import { approach, useFinePointer, useReducedMotion } from "@/components/landing/motion";

/** Controls the aura wraps. Text fields are left alone so the I-beam stays clean. */
const INTERACTIVE = 'a[href], button:not(:disabled), summary, select, label.tb-key, [role="option"], [role="button"], [data-cursor]';
const TEXT = 'input:not([type="radio"]):not([type="checkbox"]), textarea, [contenteditable="true"]';
/** Bigger than this and the aura would read as a frame around content, so it only grows a little. */
const MAX_WRAP = { w: 420, h: 96 };
const TILT_DEG = 4.5;

type Box = { x: number; y: number; w: number; h: number; r: number; o: number };

/**
 * One delegated pointer listener for the whole site (mouse and trackpad only):
 * - an aura: a lavender ring that trails the native pointer and wraps the control under it. The native
 *   cursor is never hidden, so people who rely on a large system cursor keep it.
 * - pointer light: writes --mx/--my on the `.tb-spec` surface under the pointer.
 * - tilt: writes --rx/--ry on the `[data-tilt]` element under the pointer (not under reduced motion).
 * Touch gets none of this; reduced motion keeps the light (it does not move anything) and drops the rest.
 */
export function PointerFx() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fine) return;
    const ring = ringRef.current;
    const aura = !reduced && ring !== null;
    const cur: Box = { x: -100, y: -100, w: 30, h: 30, r: 15, o: 0 };
    const target: Box = { ...cur };
    let px = -100;
    let py = -100;
    let frame = 0;
    let last = 0;
    let pressed = false;
    let tilted: HTMLElement | null = null;

    const paint = () => {
      if (!ring) return;
      const s = pressed ? 0.92 : 1;
      ring.style.transform = `translate3d(${cur.x - cur.w / 2}px, ${cur.y - cur.h / 2}px, 0) scale(${s})`;
      ring.style.width = `${cur.w}px`;
      ring.style.height = `${cur.h}px`;
      ring.style.borderRadius = `${cur.r}px`;
      ring.style.opacity = String(cur.o);
    };
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      cur.x = approach(cur.x, target.x, 0.28, dt);
      cur.y = approach(cur.y, target.y, 0.28, dt);
      cur.w = approach(cur.w, target.w, 0.22, dt);
      cur.h = approach(cur.h, target.h, 0.22, dt);
      cur.r = approach(cur.r, target.r, 0.22, dt);
      cur.o = approach(cur.o, target.o, 0.2, dt);
      paint();
      const d = Math.abs(cur.x - target.x) + Math.abs(cur.y - target.y) + Math.abs(cur.w - target.w) + Math.abs(cur.h - target.h) + Math.abs(cur.o - target.o) * 40;
      frame = d > 0.3 ? requestAnimationFrame(step) : 0;
    };
    const kick = () => {
      if (!aura || frame) return;
      last = performance.now();
      frame = requestAnimationFrame(step);
    };

    const setLit = (el: HTMLElement | null, e: PointerEvent) => {
      if (el) {
        const b = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - b.left}px`);
        el.style.setProperty("--my", `${e.clientY - b.top}px`);
      }
    };
    const setTilt = (el: HTMLElement | null, e: PointerEvent) => {
      if (el !== tilted) {
        if (tilted) {
          tilted.removeAttribute("data-tilting");
          tilted.style.removeProperty("--rx");
          tilted.style.removeProperty("--ry");
          tilted.style.removeProperty("--lift");
        }
        tilted = el;
      }
      if (!el || reduced) return;
      const b = el.getBoundingClientRect();
      const nx = (e.clientX - b.left) / b.width - 0.5;
      const ny = (e.clientY - b.top) / b.height - 0.5;
      el.dataset.tilting = "";
      el.style.setProperty("--rx", `${(-ny * TILT_DEG).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(nx * TILT_DEG).toFixed(2)}deg`);
      el.style.setProperty("--lift", "-3px");
    };

    /** Wrap the control under the pointer, or fall back to the small trailing dot. */
    const aim = (t: Element | null) => {
      if (t?.closest(TEXT)) {
        Object.assign(target, { x: px, y: py, w: 8, h: 8, r: 4, o: 0 });
      } else {
        const hit = t?.closest(INTERACTIVE) as HTMLElement | null;
        const b = hit?.getBoundingClientRect();
        if (hit && b && b.width <= MAX_WRAP.w && b.height <= MAX_WRAP.h && b.width > 0) {
          const radius = Math.min(parseFloat(getComputedStyle(hit).borderTopLeftRadius) || 8, b.height / 2 + 5);
          // Lean slightly toward the hand so the wrap feels held, not snapped.
          Object.assign(target, {
            x: b.left + b.width / 2 + (px - (b.left + b.width / 2)) * 0.08,
            y: b.top + b.height / 2 + (py - (b.top + b.height / 2)) * 0.08,
            w: b.width + 10,
            h: b.height + 10,
            r: radius + 5,
            o: 1,
          });
        } else {
          Object.assign(target, { x: px, y: py, w: 30, h: 30, r: 15, o: 0.9 });
        }
      }
    };
    let recheck = 0;
    /** A click can remove or move the control under a still pointer (a panel closes, a route changes): re-aim. */
    const reaim = () => {
      if (!aura || px < 0) return;
      aim(document.elementFromPoint(px, py));
      kick();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      px = e.clientX;
      py = e.clientY;
      const t = e.target instanceof Element ? e.target : null;
      setLit((t?.closest(".tb-spec") as HTMLElement | null) ?? null, e);
      setTilt((t?.closest("[data-tilt]") as HTMLElement | null) ?? null, e);
      if (!aura) return;
      aim(t);
      if (cur.o === 0 && cur.x === -100) Object.assign(cur, { x: px, y: py });
      kick();
    };
    const onLeave = () => {
      target.o = 0;
      setTilt(null, new PointerEvent("pointermove"));
      kick();
    };
    const onDown = () => {
      pressed = true;
      kick();
      paint();
    };
    const onUp = () => {
      pressed = false;
      paint();
      clearTimeout(recheck);
      recheck = window.setTimeout(() => {
        reaim();
        recheck = window.setTimeout(reaim, 450);
      }, 120);
    };
    // Layout moves under a still pointer (scroll): drop the wrap rather than float over the wrong thing.
    const onScroll = () => {
      if (target.o > 0 && target.w > 30) {
        Object.assign(target, { x: px, y: py, w: 30, h: 30, r: 15, o: 0.9 });
        kick();
      }
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      clearTimeout(recheck);
    };
  }, [fine, reduced]);

  if (!fine || reduced) return null;
  return (
    <div
      ref={ringRef}
      aria-hidden
      className="no-print pointer-events-none fixed top-0 z-[55] border-[1.5px] border-primary/55 bg-primary/[0.04] opacity-0 shadow-[0_0_0_1px_oklch(1_0_0/0.35),0_6px_18px_-8px_var(--iris)] will-change-transform dark:border-lavender/60 dark:shadow-[0_0_0_1px_oklch(0_0_0/0.3),0_6px_22px_-8px_var(--lavender)]"
      style={{ left: 0, width: 30, height: 30, borderRadius: 15 }}
    />
  );
}
