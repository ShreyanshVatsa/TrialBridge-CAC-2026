"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, localeFor, useLanguage, useMessages, useT } from "@/components/i18n";
import { formatDate, formatNumber } from "@/components/format";
import { Skeleton } from "@/components/site/skeleton";
import type { Meta } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useFinePointer, useReducedMotion, useWide } from "./motion";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; meta: Meta };
type Group = { id: string; count: number };
/** A row of the sorted field, in logical px (inline start = 0) relative to the canvas box. */
type Row = Group & { top: number; height: number; dotsTop: number; end: number };

/** Narrow screens show only the largest groups; there is no honest way to fit 21 rows of dots on a phone. */
const NARROW_ROWS = 8;
/** Palette values from globals.css, as hex because not every canvas implementation parses oklch. */
const LAVENDER = "#c6b8ff";
const PAPER = "#f6f4fb";
const ALPHAS = [0.28, 0.5, 0.75, 1];

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The national dataset drawn one dot per recruiting trial. Pinned while you scroll, the scattered field
 * sorts itself into a row per cancer type, using the real counts from /data/meta.json. A trial that studies
 * several cancers starts as one dot and splits into each of its rows, so the rows sum to more than the total.
 * Under reduced motion the section is not pinned and shows the sorted state directly.
 */
export function TrialField() {
  const m = useMessages();
  const { dir } = useT();
  const locale = localeFor(useLanguage());
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const wide = useWide();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    // Loaded after first paint so the data layer (and zod) stay out of the landing page's critical path.
    import("@/lib/data/loader")
      .then(({ loadMeta }) => loadMeta())
      .then((meta) => !cancelled && setState({ kind: "ok", meta }))
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const pinned = !reduced && state.kind === "ok";
  const groups: Group[] = useMemo(
    () =>
      state.kind === "ok"
        ? Object.entries(state.meta.countsByGroup)
            .map(([id, count]) => ({ id, count: count ?? 0 }))
            .filter((g) => g.count > 0)
            .sort((a, b) => b.count - a.count)
        : [],
    [state],
  );

  return (
    <section
      aria-labelledby="field-title"
      className="relative bg-ink text-paper dark:bg-card dark:text-foreground"
      style={pinned ? { height: wide ? "320svh" : "260svh" } : undefined}
    >
      <div className={cn("flex flex-col", pinned && "sticky top-0 h-svh")}>
        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 pt-24 pb-8 sm:px-6 sm:pt-28 sm:pb-10">
          {state.kind === "loading" && (
            <div role="status">
              <span className="sr-only">{m.landing.statLoading}</span>
              <Skeleton className="h-[clamp(4rem,9vw,7.5rem)] w-[min(20rem,70%)] bg-current/10" />
              <Skeleton className="mt-4 h-8 w-[28rem] max-w-full bg-current/10" />
              <Skeleton className="mt-10 h-[24rem] w-full bg-current/5" />
            </div>
          )}
          {state.kind === "error" && <p className="text-paper/75">{m.landing.statError}</p>}
          {state.kind === "ok" && (
            <>
              <div className="grid gap-x-12 gap-y-4 md:grid-cols-[auto_1fr] md:items-end">
                <p className="font-heading text-[clamp(4rem,9vw,7.5rem)] leading-[0.8] font-extrabold tracking-[-0.02em] text-lavender tabular-nums [font-stretch:58%]">
                  <CountUp value={state.meta.totalTrials} locale={locale} />
                </p>
                <div className="max-w-[44ch] md:pb-1">
                  <h2 id="field-title" className="text-[clamp(1.6rem,2.6vw,2.4rem)] leading-[1.02] font-bold tracking-[-0.01em] text-balance [font-stretch:76%]">
                    {m.landing.fieldTitle}
                  </h2>
                  <p className="mt-3 text-paper/70 dark:text-muted-foreground">
                    {formatNumber(state.meta.statesCovered, locale)} {m.landing.statStates}.{" "}
                    {format(m.landing.statDate, { date: formatDate(state.meta.dataDate, locale) })}
                    {state.meta.source === "seed" && <> {m.landing.statSeed}</>}
                  </p>
                </div>
              </div>
              <Field
                groups={groups}
                total={state.meta.totalTrials}
                labels={m.cancerGroups as Record<string, string>}
                locale={locale}
                rtl={dir === "rtl"}
                narrow={!wide}
                pinned={pinned}
                hover={fine && !reduced}
                caption={m.landing.fieldSorted}
                rest={format(m.landing.fieldRest, { shown: NARROW_ROWS, count: groups.length })}
              />
              <table className="sr-only">
                <caption>{m.landing.fieldTable}</caption>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <th scope="row">{(m.cancerGroups as Record<string, string>)[g.id] ?? g.id}</th>
                      <td>{formatNumber(g.count, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

type FieldProps = {
  groups: Group[];
  total: number;
  labels: Record<string, string>;
  locale: string;
  rtl: boolean;
  narrow: boolean;
  pinned: boolean;
  hover: boolean;
  caption: string;
  rest: string;
};

function Field({ groups, total, labels, locale, rtl, narrow, pinned, hover, caption, rest }: FieldProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const progress = useRef(pinned ? 0 : 1);
  const frame = useRef(0);
  const shown = narrow ? groups.slice(0, NARROW_ROWS) : groups;

  /** Per-dot geometry, rebuilt on resize. Scatter (s*) and sorted (t*) positions in physical canvas px. */
  const dots = useRef<{ sx: Float32Array; sy: Float32Array; tx: Float32Array; ty: Float32Array; delay: Float32Array; tone: Uint8Array; row: Int16Array; r0: number; r1: number; dpr: number }>(null);

  const draw = useCallback(() => {
    frame.current = 0;
    const cv = canvasRef.current;
    const d = dots.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !d || !ctx) return;
    const p = progress.current;
    const hot = activeRef.current;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const paths = ALPHAS.map(() => new Path2D());
    const lit = new Path2D();
    for (let k = 0; k < d.sx.length; k++) {
      const e = ease(clamp01((p - d.delay[k]!) / 0.55));
      // Dots for groups not shown on this screen fade out where they stand instead of travelling.
      const hidden = d.row[k]! < 0;
      if (hidden && e >= 1) continue;
      const x = hidden ? d.sx[k]! : d.sx[k]! + (d.tx[k]! - d.sx[k]!) * e;
      const y = hidden ? d.sy[k]! : d.sy[k]! + (d.ty[k]! - d.sy[k]!) * e;
      const r = d.r0 + (d.r1 - d.r0) * (hidden ? 0 : e);
      let tone = hidden ? Math.round(d.tone[k]! * (1 - e)) : Math.round(d.tone[k]! + (3 - d.tone[k]!) * e);
      if (hot >= 0) {
        if (d.row[k] === hot) {
          lit.moveTo(x + r, y);
          lit.arc(x, y, r, 0, Math.PI * 2);
          continue;
        }
        tone = 0;
      }
      const path = paths[tone]!;
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = LAVENDER;
    paths.forEach((path, i) => {
      ctx.globalAlpha = ALPHAS[i]!;
      ctx.fill(path);
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fill(lit);
    wrapRef.current?.style.setProperty("--sorted", clamp01((p - 0.88) / 0.12).toFixed(3));
  }, []);
  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Lay the field out for the box's current size.
  useEffect(() => {
    const box = boxRef.current;
    const cv = canvasRef.current;
    if (!box || !cv || groups.length === 0) return;
    const build = () => {
      const W = box.clientWidth;
      const H = box.clientHeight;
      if (W < 10 || H < 10) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);

      // Rows: label column on the inline start (wide), or a label line above each row (narrow).
      const n = shown.length;
      const gap = narrow ? 8 : 5;
      const labelH = narrow ? 20 : 0;
      const labelW = narrow ? 0 : Math.min(250, W * 0.24);
      const countW = narrow ? 0 : 64;
      const rowH = (H - gap * (n - 1)) / n;
      const dotsH = Math.max(4, rowH - labelH);
      const span = W - labelW - countW;
      const max = shown[0]!.count;
      let lines = 1;
      let pitch = 0;
      for (let s = 1; s <= 16; s++) {
        const p = Math.min(dotsH / s, span / Math.ceil(max / s));
        if (p > pitch) [pitch, lines] = [p, s];
      }
      const laid: Row[] = shown.map((g, i) => {
        const top = i * (rowH + gap);
        return { ...g, top, height: rowH, dotsTop: top + labelH + (dotsH - lines * pitch) / 2, end: labelW + Math.ceil(g.count / lines) * pitch };
      });
      setRows(laid);

      // One membership per (trial, group). The first `total` get their own scatter position; the rest are
      // trials already placed that also study another cancer, so they start on top of that trial's dot.
      const memberships = groups.reduce((a, g) => a + g.count, 0);
      const rand = rng(5726);
      const order = Array.from({ length: memberships }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const cols = Math.ceil(Math.sqrt((total * W) / H));
      const cell = W / cols;
      const cellH = H / Math.ceil(total / cols);
      const sx = new Float32Array(memberships);
      const sy = new Float32Array(memberships);
      const tx = new Float32Array(memberships);
      const ty = new Float32Array(memberships);
      const delay = new Float32Array(memberships);
      const tone = new Uint8Array(memberships);
      const row = new Int16Array(memberships);
      let k = 0;
      groups.forEach((g, gi) => {
        const r = laid.findIndex((x) => x.id === g.id);
        for (let j = 0; j < g.count; j++, k++) {
          const slot = order[k]! < total ? order[k]! : Math.floor(rand() * total);
          const px = ((slot % cols) + 0.5 + (rand() - 0.5) * 0.8) * cell;
          const py = (Math.floor(slot / cols) + 0.5 + (rand() - 0.5) * 0.8) * cellH;
          const lx = r >= 0 ? labelW + Math.floor(j / lines) * pitch + pitch / 2 : px;
          const ly = r >= 0 ? laid[r]!.dotsTop + (j % lines) * pitch + pitch / 2 : py;
          sx[k] = (rtl ? W - px : px) * dpr;
          sy[k] = py * dpr;
          tx[k] = (rtl ? W - lx : lx) * dpr;
          ty[k] = ly * dpr;
          delay[k] = (gi / groups.length) * 0.25 + rand() * 0.2;
          tone[k] = Math.floor(rand() * 4);
          row[k] = r;
        }
      });
      dots.current = { sx, sy, tx, ty, delay, tone, row, r0: Math.min(2.2, Math.max(1, cell * 0.24)) * dpr, r1: Math.max(0.8, pitch * 0.36) * dpr, dpr };
      schedule();
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(box);
    return () => ro.disconnect();
    // `shown` is derived from groups and narrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, total, narrow, rtl, schedule]);

  // Scroll position through the pinned section drives the sort.
  useEffect(() => {
    if (!pinned) {
      progress.current = 1;
      schedule();
      return;
    }
    const section = boxRef.current?.closest("section");
    if (!section) return;
    const read = () => {
      const r = section.getBoundingClientRect();
      const travel = r.height - window.innerHeight;
      const p = travel > 0 ? clamp01(-r.top / travel) : 1;
      const next = clamp01((p - 0.14) / 0.6);
      if (next !== progress.current) {
        progress.current = next;
        if (next < 0.95 && activeRef.current >= 0) {
          activeRef.current = -1;
          setActive(-1);
        }
        schedule();
      }
    };
    read();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [pinned, schedule]);

  const pick = (e: React.PointerEvent) => {
    if (progress.current < 0.95) return;
    const y = e.clientY - (boxRef.current?.getBoundingClientRect().top ?? 0);
    const i = rows.findIndex((r) => y >= r.top - 3 && y < r.top + r.height + 3);
    if (i !== activeRef.current) {
      activeRef.current = i;
      setActive(i);
      schedule();
    }
  };

  return (
    <div ref={wrapRef} className={cn("flex flex-col [--sorted:0]", pinned && "min-h-0 flex-1")}>
      <div
        ref={boxRef}
        aria-hidden
        onPointerMove={hover ? pick : undefined}
        onPointerLeave={
          hover
            ? () => {
                activeRef.current = -1;
                setActive(-1);
                schedule();
              }
            : undefined
        }
        className={cn("relative mt-8 w-full", pinned ? "min-h-[14rem] flex-1" : narrow ? "h-[26rem]" : "h-[34rem]")}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" />
        {rows.map((r, i) => (
          <div
            key={r.id}
            style={{ top: r.top, height: narrow ? 20 : r.height, opacity: "var(--sorted)" }}
            className={cn(
              "absolute inset-x-0 flex items-center text-sm leading-none transition-colors duration-200",
              narrow ? "justify-between" : "",
              active >= 0 && active !== i ? "text-paper/40 dark:text-foreground/40" : "text-paper/85 dark:text-foreground/85",
              active === i && "text-paper dark:text-foreground",
            )}
          >
            <span className={cn("truncate", !narrow && "w-[min(250px,24%)] pe-4")}>{labels[r.id] ?? r.id}</span>
            <span
              style={narrow ? undefined : { insetInlineStart: r.end + 10 }}
              className={cn("tabular-nums", !narrow && "absolute", active === i ? "font-bold text-paper dark:text-foreground" : "text-lavender")}
            >
              {formatNumber(r.count, locale)}
            </span>
          </div>
        ))}
      </div>
      <p style={{ opacity: "var(--sorted)" }} className="mt-5 max-w-[70ch] text-sm text-paper/70 dark:text-muted-foreground">
        {caption} {narrow && groups.length > NARROW_ROWS && rest}
      </p>
    </div>
  );
}

/** Counts up to the real value the first time it scrolls into view. The final number is what screen readers get. */
function CountUp({ value, locale }: { value: number; locale: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(reduced ? null : 0);

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let frame = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / 1600);
          setShown(Math.round(value * (1 - Math.pow(1 - p, 4))));
          frame = p < 1 ? requestAnimationFrame(tick) : 0;
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, reduced]);

  return (
    <span ref={ref}>
      <span aria-hidden>{formatNumber(shown ?? value, locale)}</span>
      <span className="sr-only">{formatNumber(value, locale)}</span>
    </span>
  );
}
