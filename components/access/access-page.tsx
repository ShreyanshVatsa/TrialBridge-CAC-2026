"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { CancerGroupId } from "@/config/cancer-groups";
import { format, localeFor, useLanguage, useMessages } from "@/components/i18n";
import { formatDate, formatNumber } from "@/components/format";
import { ErrorView } from "@/components/site/error-view";
import { Skeleton } from "@/components/site/skeleton";
import { Button } from "@/components/ui/button";
import { Ticker } from "@/components/fx/ticker";
import { PageHead } from "@/components/site/page-head";
import { ChevronDown } from "lucide-react";
import {
  getBarrierBreakdown,
  getGroupRows,
  getSiteTable,
  getStateRates,
  getSummary,
  loadAccess,
  pct,
  type AccessData,
  type BarrierMetric,
} from "@/lib/access/access";
import { cn } from "@/lib/utils";
import { STATE_NAMES, UsTileMap } from "./us-tile-map";


type State = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: AccessData; seed: boolean };
const METRICS: BarrierMetric[] = ["any", "english_required", "upper_age_limit", "disability_exclusion"];

function Card({ title, children, className, id }: { title: string; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cn("tb-surface rounded-3xl p-5 sm:p-7", className)}>
      <h2 id={id} className="text-[1.75rem] leading-[1.02] font-bold [font-stretch:70%] sm:text-[2rem]">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tb-key h-12 w-full cursor-pointer appearance-none rounded-2xl border px-4 pe-10 text-base text-foreground"
        >
          {children}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}

/** Raised stat tile: leans toward the pointer, and its number rolls to each new value as filters change. */
function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div data-tilt className="tb-surface tb-spec flex flex-col rounded-3xl p-4 sm:p-6">
      <p className="font-heading text-[2.5rem] leading-none sm:text-[3.25rem] font-extrabold text-primary [font-stretch:62%]">
        <Ticker value={value} />
      </p>
      <p className="mt-3 font-medium leading-snug sm:mt-4">{label}</p>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function AccessPage() {
  const m = useMessages();
  const lang = useLanguage();
  const locale = localeFor(lang);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [group, setGroup] = useState<CancerGroupId | null>(null);
  const [usState, setUsState] = useState<string | null>(null);
  const [metric, setMetric] = useState<BarrierMetric>("any");
  const [siteLimit, setSiteLimit] = useState(20);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAccess(), import("@/lib/data/loader").then(({ loadMeta }) => loadMeta()).catch(() => null)])
      .then(([data, meta]) => !cancelled && setState({ kind: "ok", data, seed: meta?.source === "seed" }))
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((a) => a + 1);
  }, []);

  const data = state.kind === "ok" ? state.data : null;
  const view = useMemo(() => {
    if (!data) return null;
    const f = { state: usState, group };
    return {
      summary: getSummary(data, f),
      rates: getStateRates(data, { group, metric }),
      breakdown: getBarrierBreakdown(data, f),
      groups: getGroupRows(data, usState),
      sites: getSiteTable(data, { ...f, metric }),
      states: Object.keys(data.byState).sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b)),
      groupIds: (Object.keys(data.byGroup) as CancerGroupId[]).filter((g) => g !== "other"),
    };
  }, [data, usState, group, metric]);

  const n = (x: number) => formatNumber(x, locale);
  const pc = (count: number, total: number) => format(m.access.pctCount, { rate: pct(count, total), count: n(count) });

  return (
    <main id="main" className="mx-auto min-h-dvh w-full max-w-7xl flex-1 space-y-6 px-4 pt-10 pb-24 sm:px-6 sm:pt-16 sm:pb-32">
      <PageHead title={m.access.title} intro={m.access.intro} className="max-w-5xl">
        {state.kind === "ok" && (
          <p className="mt-4 text-sm text-muted-foreground">
            {format(m.access.dataDate, { date: formatDate(state.data.dataDate, locale) })}
            {state.seed && <> {m.access.seedNote}</>}
          </p>
        )}
      </PageHead>

      {state.kind === "loading" && (
        <div role="status" className="space-y-6 pt-4">
          <span className="sr-only">{m.access.loading}</span>
          <Skeleton className="h-[6.5rem] w-full rounded-3xl sm:h-[5.25rem]" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-3xl" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
            <Skeleton className="h-[34rem] rounded-3xl" />
            <Skeleton className="h-[34rem] rounded-3xl" />
          </div>
        </div>
      )}
      {state.kind === "error" && <ErrorView body={m.access.error} onRetry={retry} showHome={false} />}

      {data && view && (
        <>
          <section aria-label={m.access.filters} className="tb-glass-panel mt-4 flex flex-col gap-3 rounded-3xl p-4 sm:flex-row sm:items-end sm:p-5">
            <Select label={m.access.group} value={group ?? ""} onChange={(v) => setGroup(v ? (v as CancerGroupId) : null)}>
              <option value="">{m.access.allGroups}</option>
              {view.groupIds.map((g) => (
                <option key={g} value={g}>
                  {m.cancerGroups[g]}
                </option>
              ))}
            </Select>
            <Select label={m.access.state} value={usState ?? ""} onChange={(v) => setUsState(v || null)}>
              <option value="">{m.access.allStates}</option>
              {view.states.map((s) => (
                <option key={s} value={s}>
                  {STATE_NAMES[s] ?? s}
                </option>
              ))}
            </Select>
            <Select label={m.access.metric} value={metric} onChange={(v) => setMetric(v as BarrierMetric)}>
              {METRICS.map((x) => (
                <option key={x} value={x}>
                  {m.access.metrics[x]}
                </option>
              ))}
            </Select>
            {(group || usState) && (
              <Button
                variant="outline"
                className="h-12 rounded-2xl"
                onClick={() => {
                  setGroup(null);
                  setUsState(null);
                }}
              >
                {m.access.clear}
              </Button>
            )}
          </section>

          <div aria-live="polite" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Stat value={n(view.summary.trials)} label={m.access.statTrials} />
            <Stat
              value={`${pct(view.summary.anyBarrier, view.summary.trials)}%`}
              label={m.access.statAny}
              sub={format(m.access.ofTrials, { count: n(view.summary.anyBarrier), total: n(view.summary.trials) })}
            />
            <Stat
              value={`${pct(view.summary.english_required, view.summary.trials)}%`}
              label={m.access.statEnglish}
              sub={format(m.access.ofTrials, { count: n(view.summary.english_required), total: n(view.summary.trials) })}
            />
            <Stat
              value={`${pct(view.summary.upper_age_limit, view.summary.trials)}%`}
              label={m.access.statAge}
              sub={format(m.access.ofTrials, { count: n(view.summary.upper_age_limit), total: n(view.summary.trials) })}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
            <Card title={`${m.access.mapTitle}: ${m.access.metrics[metric]}`} id="map-title">
              <p className="mb-4 text-sm text-muted-foreground">{m.access.mapNote}</p>
              <UsTileMap rates={view.rates} selected={usState} onSelect={setUsState} />
            </Card>

            <Card title={m.access.chartTitle} id="chart-title">
              <p className="mb-2 text-sm text-muted-foreground">{m.access.chartNote}</p>
              {/* Plain HTML bars: each one glides to its new length when the filters change. */}
              <figure aria-labelledby="chart-title" className="mt-4">
                <ul className="space-y-5">
                  {view.breakdown.map((b) => (
                    <li key={b.type}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{m.access.metrics[b.type]}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">{format(m.access.chartValue, { rate: b.rate, count: n(b.count) })}</span>
                      </div>
                      <span aria-hidden className="mt-2 block h-3 overflow-hidden rounded-full bg-muted shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.15)]">
                        <span
                          className="block h-full rounded-full bg-[linear-gradient(90deg,var(--lavender),var(--primary))] shadow-[inset_0_1px_0_oklch(1_0_0/0.35)] transition-[width] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] rtl:bg-[linear-gradient(270deg,var(--lavender),var(--primary))]"
                          style={{ width: `${Math.min(100, b.rate)}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </figure>
            </Card>
          </div>

          <Card title={m.access.groupsTitle}>
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {view.groups
                .filter((g) => g.trials > 0 && g.group !== "other")
                .map((g) => (
                  <li key={g.group}>
                    <button
                      type="button"
                      onClick={() => setGroup(group === g.group ? null : g.group)}
                      aria-pressed={group === g.group}
                      className={cn(
                        "w-full rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-muted",
                        group === g.group && "bg-secondary ring-1 ring-primary/40",
                      )}
                    >
                      <span className="flex justify-between gap-3">
                        <span className="font-medium">{m.cancerGroups[g.group]}</span>
                        <span className="text-sm text-muted-foreground tabular-nums">{pc(g.anyBarrier, g.trials)}</span>
                      </span>
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="block h-full rounded-full bg-primary transition-[width] duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: `${g.rate}%` }} />
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </Card>

          <Card title={format(m.access.sitesTitle, { min: data.minSiteTrials })} id="sites-title">
            <p className="mb-4 text-sm text-muted-foreground">{m.access.sitesNote}</p>
            {view.sites.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
                {format(m.access.sitesEmpty, { min: data.minSiteTrials })}
              </p>
            ) : (
              <div className="-mx-5 overflow-x-auto sm:mx-0" tabIndex={0} role="region" aria-labelledby="sites-title">
                <table className="w-full min-w-[44rem] text-start text-sm">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-medium">{m.access.colRank}</th>
                      <th scope="col" className="px-3 py-2 text-start font-medium">{m.access.colSite}</th>
                      <th scope="col" className="px-3 py-2 text-end font-medium">{m.access.colTrials}</th>
                      {METRICS.map((x) => (
                        <th key={x} scope="col" className={cn("px-3 py-2 text-end font-medium", x === metric && "text-foreground")}>
                          {m.access.metrics[x]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {view.sites.slice(0, siteLimit).map((s, i) => (
                      <tr key={`${s.facility}-${s.city}-${s.state}`} className="transition-colors hover:bg-muted/60">
                        <td className="px-3 py-2.5 font-heading text-lg font-bold text-muted-foreground tabular-nums [font-stretch:70%]">{i + 1}</td>
                        <th scope="row" className="px-3 py-2.5 text-start font-medium">
                          {s.facility}
                          <span className="block font-normal text-muted-foreground">
                            {s.city}, {s.state}
                          </span>
                        </th>
                        <td className="px-3 py-2.5 text-end tabular-nums">{n(s.trials)}</td>
                        <td className={cn("px-3 py-2.5 text-end tabular-nums", metric === "any" && "font-semibold")}>{pc(s.anyBarrier, s.trials)}</td>
                        <td className={cn("px-3 py-2.5 text-end tabular-nums", metric === "english_required" && "font-semibold")}>
                          {pc(s.english_required, s.trials)}
                        </td>
                        <td className={cn("px-3 py-2.5 text-end tabular-nums", metric === "upper_age_limit" && "font-semibold")}>
                          {pc(s.upper_age_limit, s.trials)}
                        </td>
                        <td className={cn("px-3 py-2.5 text-end tabular-nums", metric === "disability_exclusion" && "font-semibold")}>
                          {pc(s.disability_exclusion, s.trials)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {view.sites.length > siteLimit && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={() => setSiteLimit((l) => l + 30)}>
                  {m.common.showMore}
                </Button>
              </div>
            )}
          </Card>

          <section className="tb-reveal rounded-3xl border border-border bg-muted/40 p-5 sm:p-7">
            <h2 className="text-[1.75rem] leading-[1.02] font-bold [font-stretch:70%]">{m.access.howFlagged}</h2>
            <p className="mt-2 max-w-[70ch] text-muted-foreground">{m.access.howFlaggedBody}</p>
            <Link href="/methodology/" className="mt-3 inline-block font-medium text-primary underline underline-offset-4">
              {m.access.methodologyLink}
            </Link>
          </section>
        </>
      )}
    </main>
  );
}
