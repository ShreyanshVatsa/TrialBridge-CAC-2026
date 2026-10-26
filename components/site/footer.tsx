"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { format, useLanguage, useMessages } from "@/components/i18n";
import { StretchWord } from "@/components/landing/stretch-word";
import { LogoMark } from "./logo";

export function SiteFooter() {
  const m = useMessages();
  const lang = useLanguage();
  const ref = useRef<HTMLElement>(null);

  // The footer waits under the page (sticky bottom). When it is taller than the window, stick it by its top
  // instead, so its links are the first thing revealed rather than hidden under the sheet.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => el.style.setProperty("--reveal-bottom", `${Math.min(0, window.innerHeight - el.offsetHeight)}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);
  const columns = [
    {
      title: m.footer.product,
      links: [
        { href: "/find/", label: m.nav.find },
        { href: "/access/", label: m.nav.accessIntel },
        { href: "/methodology/", label: m.nav.methodology },
      ],
    },
    {
      title: m.footer.company,
      links: [
        { href: "/about/", label: m.nav.about },
        { href: "/for-sites/", label: m.nav.forSites },
      ],
    },
    {
      title: m.footer.legal,
      links: [
        { href: "/privacy/", label: m.footer.privacy },
        { href: "/privacy-policy/", label: m.footer.privacyPolicy },
        { href: "/terms/", label: m.footer.terms },
      ],
    },
  ];
  return (
    <footer ref={ref} className="tb-footer-reveal no-print mt-auto overflow-hidden bg-ink text-paper dark:bg-card dark:text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pt-16 pb-12 sm:px-6 md:grid-cols-[1.3fr_2fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-heading text-2xl font-extrabold [font-stretch:70%]">
            <LogoMark className="size-7" />
            {m.common.brand}
          </div>
          <p className="max-w-prose opacity-80">{m.footer.tagline}</p>
          <p className="max-w-prose text-sm opacity-70">{m.disclaimer.text}</p>
          {lang !== "en" && <p className="text-sm font-medium">{m.footer.translationNote}</p>}
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {columns.map((c) => (
            <div key={c.title}>
              <h2 className="font-sans text-sm font-semibold [font-stretch:100%] text-lavender">{c.title}</h2>
              <ul className="mt-3 space-y-2">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat pb-0.5 transition-[background-size,color] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[length:100%_1px] hover:text-lavender rtl:bg-right-bottom"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto max-w-7xl space-y-1 border-t border-current/15 px-4 py-6 text-sm opacity-70 sm:px-6">
        <p>{m.footer.dataSource}</p>
        <p>{format(m.footer.copyright, { year: new Date().getFullYear() })}</p>
      </div>
      <div className="flex justify-center px-3 text-lavender sm:px-6">
        <StretchWord text={m.common.brand} className="translate-y-[0.14em] text-[clamp(4rem,26.5vw,30rem)] tracking-[-0.02em]" />
      </div>
    </footer>
  );
}
