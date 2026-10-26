"use client";

import { useEffect } from "react";
import { useFinePointer, useReducedMotion } from "./motion";

/**
 * Inertial wheel scrolling for the landing page only, where the pinned sections are paced by scroll.
 * Lenis drives the real window scroll position, so sticky, anchors, find-in-page and IntersectionObserver
 * all keep working. Touch keeps native scrolling; reduced motion keeps everything native.
 */
export function SmoothScroll() {
  const reduced = useReducedMotion();
  const fine = useFinePointer();

  useEffect(() => {
    if (reduced || !fine) return;
    let frame = 0;
    let stop = () => {};
    let cancelled = false;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.9, anchors: true });
      const raf = (t: number) => {
        lenis.raf(t);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
      stop = () => lenis.destroy();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stop();
    };
  }, [reduced, fine]);

  return null;
}
