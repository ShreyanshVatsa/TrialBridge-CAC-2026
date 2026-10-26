"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "./analyze";

const CACHE_KEY = "tb-demo-mode";

/**
 * Whether this page is served by the local demo server (`npm run demo`, which sets DEMO_MODE; /api/health says
 * `demo: true`). false until known, so the page never waits on it: the last answer for this origin is used at once
 * when the browser remembers it, then /api/health confirms it. Any failure means "not the demo".
 */
export function useDemoMode(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    let live = true;
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached !== null) void Promise.resolve().then(() => live && setDemo(cached === "1"));
    } catch {
      /* storage unavailable: wait for /api/health */
    }
    // Never aborted: nothing waits on it, and an aborted request would linger unanswered in the page's request list.
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.json() as Promise<{ demo?: boolean }>)
      .then((h) => h.demo === true)
      .catch(() => false)
      .then((d) => {
        if (!live) return;
        setDemo(d);
        try {
          localStorage.setItem(CACHE_KEY, d ? "1" : "0");
        } catch {
          /* ignore */
        }
      });
    return () => {
      live = false;
    };
  }, []);
  return demo;
}
