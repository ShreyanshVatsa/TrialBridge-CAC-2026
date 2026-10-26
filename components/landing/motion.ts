"use client";

import { useSyncExternalStore } from "react";

function mediaHook(query: string, serverValue: boolean) {
  const subscribe = (cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  };
  return () => useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

/** True when the person asked the OS for less motion. Every interactive effect checks this. */
export const useReducedMotion = mediaHook("(prefers-reduced-motion: reduce)", true);
/** True for a mouse or trackpad. Hover-driven effects only run here; touch gets a tap equivalent. */
export const useFinePointer = mediaHook("(hover: hover) and (pointer: fine)", false);
/** True at the `lg` breakpoint and wider. */
export const useWide = mediaHook("(min-width: 64rem)", false);

/** Frame-rate independent ease toward a target: `k` is roughly the share of the gap closed per 16ms frame. */
export function approach(current: number, target: number, k: number, dt: number) {
  return current + (target - current) * (1 - Math.pow(1 - k, dt / 16.7));
}
