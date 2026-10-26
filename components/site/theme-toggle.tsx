"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useMessages } from "@/components/i18n";

const STORAGE_KEY = "tb-theme";

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

const isDark = () => document.documentElement.classList.contains("dark");

/** Toggles light/dark. The saved choice is a display preference only (no personal data). */
export function ThemeToggle() {
  const m = useMessages();
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = !isDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Storage blocked: the toggle still works for this page view.
    }
  }

  // Sun and moon share the button: one turns away as the other turns in.
  const icon = "absolute size-5 transition-[rotate,scale,opacity] duration-500 ease-[cubic-bezier(0.2,1.4,0.4,1)] motion-reduce:transition-none";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={m.nav.themeToggle}
      aria-pressed={dark}
      className="relative inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Sun className={`${icon} ${dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"}`} aria-hidden />
      <Moon className={`${icon} ${dark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"}`} aria-hidden />
    </button>
  );
}
