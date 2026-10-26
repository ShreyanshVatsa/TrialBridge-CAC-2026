"use client";

import Link from "next/link";
import { Glasses } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMessages } from "@/components/i18n";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Magnetic } from "./magnetic";
import { approach, useFinePointer, useReducedMotion } from "./motion";

/** Centre and half-size of the lens, in px relative to the wall. */
type Lens = { x: number; y: number; w: number; h: number };

/**
 * The landing hero. A wall of trial eligibility rules as they are written, and a lens that shows each one in
 * plain language underneath it: the product's whole job, as a thing you can move your hand over.
 * Two identical grids are stacked; the plain-language one is clipped to a circle driven by CSS variables,
 * so following the pointer never re-renders React. Touch and keyboard get the same reveal through a tap
 * and the "show all" toggle.
 */
export function LensHero() {
  const m = useMessages().landing;
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const wallRef = useRef<HTMLDivElement>(null);
  const cur = useRef<Lens>({ x: 0, y: 0, w: 0, h: 0 });
  const target = useRef<Lens>({ x: 0, y: 0, w: 0, h: 0 });
  const frame = useRef(0);
  const last = useRef(0);
  const [all, setAll] = useState(false);
  /** Rule the lens is resting on, or -1 when it is closed or covering everything. */
  const at = useRef(0);

  const paint = useCallback(() => {
    const el = wallRef.current;
    if (!el) return;
    const { x, y, w, h } = cur.current;
    el.style.setProperty("--lx", `${x}px`);
    el.style.setProperty("--ly", `${y}px`);
    el.style.setProperty("--lw", `${Math.max(0, w)}px`);
    el.style.setProperty("--lh", `${Math.max(0, h)}px`);
  }, []);

  const kick = useCallback(() => {
    if (reduced) {
      cur.current = { ...target.current };
      paint();
      return;
    }
    if (frame.current) return;
    last.current = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last.current);
      last.current = now;
      const c = cur.current;
      const t = target.current;
      c.x = approach(c.x, t.x, 0.2, dt);
      c.y = approach(c.y, t.y, 0.2, dt);
      c.w = approach(c.w, t.w, 0.16, dt);
      c.h = approach(c.h, t.h, 0.16, dt);
      paint();
      const settled = Math.abs(c.x - t.x) + Math.abs(c.y - t.y) + Math.abs(c.w - t.w) + Math.abs(c.h - t.h) < 0.3;
      frame.current = settled ? 0 : requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [paint, reduced]);

  /** Lens hugging rule `i`'s plain-language sentence with even padding, relative to the wall. */
  const fit = (i: number): Lens | undefined => {
    const wall = wallRef.current;
    const text = wall?.querySelectorAll<HTMLElement>("[data-plain]")[i]?.getBoundingClientRect();
    if (!wall || !text) return undefined;
    const box = wall.getBoundingClientRect();
    const pad = box.width < 640 ? 16 : 28;
    const w = text.width / 2 + pad;
    const x = text.left - box.left + text.width / 2;
    // Keep the glass inside the page gutter so it never touches the screen edge.
    const edge = box.width < 640 ? 6 : 12;
    return { x: Math.min(Math.max(x, w + edge), box.width - w - edge), y: text.top - box.top + text.height / 2, w, h: text.height / 2 + pad * 0.62 };
  };
  const coverAll = () => {
    const el = wallRef.current;
    const w = el?.clientWidth ?? 2000;
    const h = el?.clientHeight ?? 1000;
    return { x: w / 2, y: h / 2, w: w / 2 + 40, h: h / 2 + 40 };
  };

  // Opening moment: the lens settles on the first rule, so the idea is visible before anyone moves.
  useEffect(() => {
    const el = wallRef.current;
    if (!el) return;
    const first = fit(0);
    if (!first) return;
    cur.current = { ...first, w: 0, h: 0 };
    target.current = first;
    const id = setTimeout(kick, reduced ? 0 : 700);
    // Text reflows when the web font arrives and on resize: re-fit the lens to whatever it is resting on.
    const refit = () => {
      const lens = at.current >= 0 ? fit(at.current) : undefined;
      if (lens) Object.assign(target.current, lens);
      else if (at.current === -2) Object.assign(target.current, coverAll());
      kick();
    };
    document.fonts?.ready.then(refit);
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    return () => {
      clearTimeout(id);
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [kick, reduced]);

  // The lens settles on the rule under the pointer, leaning slightly toward the hand so it feels physical.
  const moveTo = (e: React.PointerEvent) => {
    const wall = wallRef.current;
    if (!wall || all) return;
    // Nearest rule, measured to its box (0 inside it), so crossing the gutters never drops the lens.
    let i = -1;
    let best = Infinity;
    wall.querySelectorAll<HTMLElement>("[data-cell]").forEach((el, j) => {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - e.clientX, 0, e.clientX - r.right), Math.max(r.top - e.clientY, 0, e.clientY - r.bottom));
      if (d < best) [best, i] = [d, j];
    });
    const lens = i >= 0 ? fit(i) : undefined;
    if (lens) {
      const box = wall.getBoundingClientRect();
      lens.x += (e.clientX - box.left - lens.x) * 0.1;
      lens.y += (e.clientY - box.top - lens.y) * 0.1;
    }
    at.current = lens ? i : -1;
    Object.assign(target.current, lens ?? { w: 0, h: 0 });
    kick();
  };

  const toggleAll = () => {
    const next = !all;
    setAll(next);
    at.current = next ? -2 : -1;
    Object.assign(target.current, next ? coverAll() : { w: 0, h: 0 });
    kick();
  };

  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      <div className="mx-auto grid max-w-7xl gap-x-16 gap-y-8 px-4 pt-8 pb-8 sm:px-6 sm:pt-12 lg:grid-cols-[1.5fr_1fr] lg:items-end lg:pb-10">
        <h1
          id="hero-title"
          className="text-[clamp(2.6rem,6.2vw,6.25rem)] leading-[0.92] font-[760] tracking-[-0.012em] text-balance [font-stretch:66%]"
        >
          {m.headline.split(" ").map((word, i) => (
            <span key={i} className="inline-block pb-[0.08em] align-bottom">
              <span className="inline-block animate-rise" style={{ animationDelay: `${i * 35}ms` }}>
                {word}
                {" "}
              </span>
            </span>
          ))}
        </h1>
        <div className="max-w-[46ch]">
          <p className="text-lg text-muted-foreground sm:text-xl">{m.sub}</p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Magnetic>
              <Link href="/find/" className={cn(buttonVariants({ size: "lg" }), "min-h-14 px-8 text-lg")}>
                {m.cta}
              </Link>
            </Magnetic>
            <button
              type="button"
              aria-pressed={all}
              onClick={toggleAll}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-14 px-5 text-base", all && "border-ink/30 bg-lavender text-ink hover:bg-lavender/80 hover:text-ink")}
            >
              <Glasses aria-hidden />
              {all ? m.lensShowOriginal : m.lensShowAll}
            </button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <span className="[@media(hover:hover)_and_(pointer:fine)]:hidden">{m.lensHintTouch}</span>
            <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline">{m.lensHintHover}</span>
          </p>
        </div>
      </div>
      <div
        ref={wallRef}
        role="group"
        aria-label={m.lensLabel}
        onPointerMove={fine ? moveTo : undefined}
        onPointerDown={fine ? undefined : moveTo}
        onPointerLeave={() => {
          if (!fine || all) return;
          at.current = -1;
          target.current.w = 0;
          target.current.h = 0;
          kick();
        }}
        className="relative mb-16 h-[clamp(17rem,44svh,27rem)] sm:mb-24 touch-pan-y select-none [mask-image:linear-gradient(to_bottom,black_80%,transparent)]"
      >
        <CriteriaGrid pairs={m.lensPairs} show="legal" />
        {/* Under the glass: the same grid in plain language, magnified slightly around the lens centre. */}
        <div aria-hidden className="absolute inset-0 bg-lavender [clip-path:inset(calc(var(--ly,0px)-var(--lh,0px))_calc(100%-var(--lx,0px)-var(--lw,0px))_calc(100%-var(--ly,0px)-var(--lh,0px))_calc(var(--lx,0px)-var(--lw,0px))_round_1.75rem)]">
          <div className="absolute inset-0 [transform-origin:var(--lx,0px)_var(--ly,0px)] scale-[1.035]">
            <CriteriaGrid pairs={m.lensPairs} show="plain" />
          </div>
        </div>
        {/* Physical left on purpose: pointer coordinates are physical in both LTR and RTL. */}
        <div
          aria-hidden
          style={{ left: 0 }}
          className="tb-glass pointer-events-none absolute top-0 rounded-[1.75rem] [width:calc(var(--lw,0px)*2)] [height:calc(var(--lh,0px)*2)] [transform:translate3d(calc(var(--lx,0px)-var(--lw,0px)),calc(var(--ly,0px)-var(--lh,0px)),0)]"
        />
        <ul className="sr-only">
          {m.lensPairs.map((p) => (
            <li key={p.legal}>
              {p.legal} {p.plain}
            </li>
          ))}
        </ul>
      </div>

    </section>
  );
}

/** One layer of the rule wall. Both texts occupy the same grid cell in both layers, so cells line up exactly. */
function CriteriaGrid({ pairs, show }: { pairs: readonly { legal: string; plain: string }[]; show: "legal" | "plain" }) {
  return (
    <ul aria-hidden className="absolute inset-x-0 top-0 mx-auto grid max-w-7xl auto-rows-min grid-cols-2 content-start gap-x-6 px-4 sm:grid-cols-3 sm:gap-x-10 sm:px-6 lg:grid-cols-4">
      {pairs.map((p) => (
        <li key={p.legal} data-cell={show === "legal" ? "" : undefined} className="grid content-start border-t border-current/10 pt-4 pb-6 sm:pt-5 sm:pb-9">
          <span
            className={cn(
              "[grid-area:1/1] text-[0.8rem] leading-snug sm:text-[0.95rem]",
              show === "legal" ? "text-muted-foreground" : "invisible",
            )}
          >
            {p.legal}
          </span>
          <span
            data-plain={show === "legal" ? "" : undefined}
            className={cn(
              "[grid-area:1/1] self-start justify-self-start font-heading text-[1.05rem] leading-[1.1] font-bold [font-stretch:82%] sm:text-[1.35rem]",
              show === "plain" ? "text-ink" : "invisible",
            )}
          >
            {p.plain}
          </span>
        </li>
      ))}
    </ul>
  );
}
