"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useMessages } from "@/components/i18n";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { LogoMark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const m = useMessages();
  const pathname = usePathname();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const links = [
    { href: "/access/", label: m.nav.accessIntel },
    { href: "/for-sites/", label: m.nav.forSites },
    { href: "/methodology/", label: m.nav.methodology },
    { href: "/about/", label: m.nav.about },
    { href: "/privacy/", label: m.nav.privacy },
  ];

  // Close the mobile menu after navigation.
  useEffect(() => {
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);

  // Glass appears once the page moves; the bar slides away while reading down and returns on any scroll up.
  // State lives in data attributes so scrolling never re-renders the header.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    let last = window.scrollY;
    let frame = 0;
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      el.dataset.scrolled = String(y > 8);
      if (Math.abs(y - last) < 6) return;
      el.dataset.hidden = String(y > last && y > 240 && !menuRef.current?.open);
      last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // One glass pill slides between nav links: it rests on the current page and follows the pointer.
  const navRef = useRef<HTMLElement>(null);
  const pillTo = useCallback((el: HTMLElement | null) => {
    const nav = navRef.current;
    if (!nav) return;
    if (!el) {
      nav.style.setProperty("--pill-o", "0");
      return;
    }
    nav.style.setProperty("--pill-x", `${el.offsetLeft}px`);
    nav.style.setProperty("--pill-w", `${el.offsetWidth}px`);
    nav.style.setProperty("--pill-o", "1");
  }, []);
  const restPill = useCallback(() => pillTo(navRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? null), [pillTo]);
  useEffect(() => {
    restPill();
    document.fonts?.ready.then(restPill);
    window.addEventListener("resize", restPill);
    return () => window.removeEventListener("resize", restPill);
  }, [pathname, restPill]);

  const isActive = (href: string) => (pathname ?? "").replace(/\/?$/, "/") === href;
  const linkClass = (href: string) =>
    cn(
      "relative z-10 rounded-full px-2 py-2 whitespace-nowrap text-muted-foreground 2xl:px-2.5 transition-colors hover:text-foreground",
      isActive(href) && "font-medium text-foreground",
    );

  return (
    <header
      ref={headerRef}
      data-scrolled="false"
      data-hidden="false"
      className="group/header no-print sticky top-0 z-30 [view-transition-name:site-header] px-3 pt-3 transition-transform duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] data-[hidden=true]:not-focus-within:-translate-y-[calc(100%+0.75rem)] sm:px-6 motion-reduce:transition-none"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 rounded-full border border-transparent ps-3 pe-2 transition-[background-color,border-color,box-shadow] duration-500 group-data-[scrolled=true]/header:border-border group-data-[scrolled=true]/header:bg-background/90 group-data-[scrolled=true]/header:shadow-[0_1px_0_oklch(1_0_0/0.6)_inset,0_10px_30px_-18px_oklch(0.2_0.06_295/0.35)] dark:group-data-[scrolled=true]/header:shadow-[0_1px_0_oklch(1_0_0/0.08)_inset,0_14px_34px_-18px_oklch(0_0_0/0.7)] group-data-[scrolled=true]/header:backdrop-blur-xl group-data-[scrolled=true]/header:backdrop-saturate-150 supports-[backdrop-filter]:group-data-[scrolled=true]/header:bg-background/88 sm:ps-4">
        <Link href="/" className="flex items-center gap-2.5 rounded-full font-heading text-2xl font-extrabold tracking-tight [font-stretch:70%]">
          <LogoMark />
          <span className="sr-only min-[400px]:not-sr-only">{m.common.brand}</span>
        </Link>
        <nav ref={navRef} aria-label={m.nav.label} onPointerLeave={restPill} className="relative hidden items-center gap-0.5 [--pill-o:0] xl:flex">
          {/* Physical left on purpose: offsetLeft is physical in LTR and RTL alike. */}
          <span
            aria-hidden
            style={{ left: 0 }}
            className="tb-surface-flat absolute top-1/2 h-10 w-(--pill-w) -translate-y-1/2 translate-x-(--pill-x) rounded-full opacity-(--pill-o) transition-[translate,width,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          />
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onPointerEnter={(e) => pillTo(e.currentTarget)}
              onFocus={(e) => pillTo(e.currentTarget)}
              onBlur={restPill}
              className={linkClass(l.href)}
              aria-current={isActive(l.href) ? "page" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
          <Link href="/find/" className={cn(buttonVariants({ size: "sm" }), "hidden min-h-11 rounded-full px-5 text-base whitespace-nowrap sm:inline-flex")}>
            {m.nav.find}
          </Link>
          <details ref={menuRef} className="relative xl:hidden">
            <summary
              className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden"
              aria-label={m.nav.menu}
            >
              <Menu className="size-5" aria-hidden />
            </summary>
            <nav
              aria-label={m.nav.menu}
              className="tb-glass-panel tb-pop-in absolute end-0 mt-3 flex w-64 origin-top-right flex-col rounded-3xl p-2 rtl:origin-top-left"
            >
              <Link href="/find/" className="rounded-full px-3.5 py-2.5 font-medium text-primary">
                {m.nav.find}
              </Link>
              {links.map((l) => (
                <Link key={l.href} href={l.href} className={cn(linkClass(l.href), "py-2.5 hover:bg-muted", isActive(l.href) && "bg-muted")} aria-current={isActive(l.href) ? "page" : undefined}>
                  {l.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
