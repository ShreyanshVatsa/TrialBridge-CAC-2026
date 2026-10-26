"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useMessages, type Messages } from "@/components/i18n";

/** Page title for a route in the active language (static export metadata is English only). */
function pageTitle(pathname: string, m: Messages): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  const names: Record<string, string> = {
    "/find": m.chat.title,
    "/privacy": m.nav.privacy,
    "/access": m.nav.accessIntel,
    "/for-sites": m.nav.forSites,
    "/methodology": m.nav.methodology,
    "/about": m.nav.about,
    "/offline": m.meta.pages.offline,
    "/terms": m.meta.pages.terms,
    "/privacy-policy": m.meta.pages.privacyPolicy,
  };
  const name = names[path];
  return name ? `${name} · TrialBridge` : m.meta.title;
}

/**
 * Keeps the tab title and meta description in the active UI language. The trial page sets its own
 * title (from the loaded trial), so it is left alone.
 */
export function DocumentMeta() {
  const m = useMessages();
  const pathname = usePathname();
  useEffect(() => {
    const apply = () => {
      const title = pathname.startsWith("/trial") ? null : pageTitle(pathname, m);
      if (title !== null && document.title !== title) document.title = title;
      const desc = document.querySelector('meta[name="description"]');
      if (desc && desc.getAttribute("content") !== m.meta.description) desc.setAttribute("content", m.meta.description);
    };
    apply();
    // Next may (re)insert its English metadata after hydration or on navigation; keep ours on top.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["content"] });
    return () => observer.disconnect();
  }, [m, pathname]);
  return null;
}
