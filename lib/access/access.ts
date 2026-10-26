/**
 * Access Intelligence helpers for the UI (client-side, pure functions over /data/access.json).
 * All rates are computed from counts; always show counts next to percentages.
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import type { BarrierType } from "@/lib/types/trial";
import { AccessDataSchema, type AccessData, type CountsTuple } from "@/lib/types/access";

export type { AccessData };

export interface Counts {
  trials: number;
  anyBarrier: number;
  english_required: number;
  upper_age_limit: number;
  disability_exclusion: number;
}
export type BarrierMetric = "any" | BarrierType;
interface AccessFilters {
  /** State postal code, e.g. "TX". */
  state?: string | null;
  group?: CancerGroupId | null;
}

export const toCounts = (t: CountsTuple | undefined): Counts => ({
  trials: t?.[0] ?? 0,
  anyBarrier: t?.[1] ?? 0,
  english_required: t?.[2] ?? 0,
  upper_age_limit: t?.[3] ?? 0,
  disability_exclusion: t?.[4] ?? 0,
});

/** Percentage 0..100 rounded to 1 decimal; 0 when the denominator is 0. */
export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

const metricCount = (c: Counts, m: BarrierMetric) => (m === "any" ? c.anyBarrier : c[m]);

let accessPromise: Promise<AccessData> | null = null;
/** Load and validate /data/access.json (memoized; retried on failure). */
export function loadAccess(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<AccessData> {
  accessPromise ??= (async () => {
    const res = await fetchImpl("/data/access.json", { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`access.json HTTP ${res.status}`);
    return AccessDataSchema.parse(await res.json());
  })();
  accessPromise.catch(() => {
    accessPromise = null;
  });
  return accessPromise;
}

/** Stat cards: counts for the current filters (state and/or cancer type). */
export function getSummary(data: AccessData, f: AccessFilters = {}): Counts {
  if (f.state && f.group) return toCounts(data.byStateGroup[f.state]?.[f.group]);
  if (f.state) return toCounts(data.byState[f.state]);
  if (f.group) return toCounts(data.byGroup[f.group]);
  return toCounts(data.totals);
}

/** Map data: per-state barrier rate for a metric, optionally within one cancer type. */
export function getStateRates(data: AccessData, opts: { group?: CancerGroupId | null; metric?: BarrierMetric } = {}): Array<{ state: string; trials: number; count: number; rate: number }> {
  const metric = opts.metric ?? "any";
  return Object.keys(data.byState)
    .sort()
    .map((state) => {
      const c = toCounts(opts.group ? data.byStateGroup[state]?.[opts.group] : data.byState[state]);
      return { state, trials: c.trials, count: metricCount(c, metric), rate: pct(metricCount(c, metric), c.trials) };
    })
    .filter((r) => r.trials > 0);
}

/** Barrier-type chart rows for the current filters. */
export function getBarrierBreakdown(data: AccessData, f: AccessFilters = {}): Array<{ type: BarrierMetric; count: number; rate: number }> {
  const c = getSummary(data, f);
  return (["any", "english_required", "upper_age_limit", "disability_exclusion"] as const).map((type) => ({ type, count: metricCount(c, type), rate: pct(metricCount(c, type), c.trials) }));
}

/** Cancer-type rows (for a filter list or chart), optionally within a state. Sorted by trials desc. */
export function getGroupRows(data: AccessData, state?: string | null): Array<{ group: CancerGroupId; trials: number; anyBarrier: number; rate: number }> {
  const src = state ? (data.byStateGroup[state] ?? {}) : data.byGroup;
  return (Object.entries(src) as [CancerGroupId, CountsTuple][])
    .map(([group, t]) => {
      const c = toCounts(t);
      return { group, trials: c.trials, anyBarrier: c.anyBarrier, rate: pct(c.anyBarrier, c.trials) };
    })
    .sort((a, b) => b.trials - a.trials || a.group.localeCompare(b.group));
}

interface SiteRow extends Counts {
  facility: string;
  city: string;
  state: string;
  rate: number;
}

/** Ranked table of sites with >= minTrials trials (default from data, 5), filtered by state/cancer type. */
export function getSiteTable(data: AccessData, f: AccessFilters & { metric?: BarrierMetric; minTrials?: number; limit?: number } = {}): SiteRow[] {
  const metric = f.metric ?? "any";
  const min = f.minTrials ?? data.minSiteTrials;
  return data.sites
    .filter((s) => !f.state || s.state === f.state)
    .map((s) => {
      const c = toCounts(f.group ? s.groups[f.group] : s.counts);
      return { facility: s.facility, city: s.city, state: s.state, ...c, rate: pct(metricCount(c, metric), c.trials) };
    })
    .filter((r) => r.trials >= min)
    .sort((a, b) => b.rate - a.rate || b.trials - a.trials || a.facility.localeCompare(b.facility))
    .slice(0, f.limit ?? 100);
}
