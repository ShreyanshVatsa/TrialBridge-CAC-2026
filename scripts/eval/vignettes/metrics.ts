/**
 * Metrics for the vignette benchmark: graded and binary nDCG, hit@k, P@k and its ceiling, recall, excluded and unjudged
 * share, condensed (judged-only) lists, paired bootstrap. Pure functions.
 */
import { GAIN, type Label } from "./judge-prompt";

/** Labels of the judged trials of one vignette (NCT id -> label). Unjudged (never pooled) trials count as gain 0. */
export type VignetteLabels = Readonly<Record<string, Label>>;

const gainOf = (labels: VignetteLabels, id: string) => (labels[id] ? GAIN[labels[id] as Label] : 0);

/** Graded nDCG@k, gain 3/2/0/0, discount 1/log2(rank + 1); ideal = the judged gains sorted descending. 0 when nothing is relevant. */
export function ndcgAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  const dcg = (gains: number[]) => gains.slice(0, k).reduce((a, g, i) => a + g / Math.log2(i + 2), 0);
  const ideal = dcg(Object.values(labels).map((l) => GAIN[l]).sort((a, b) => b - a));
  return ideal === 0 ? 0 : dcg(ranked.slice(0, k).map((id) => gainOf(labels, id))) / ideal;
}

/** Share of the eligible trials found in the top k; NaN when the vignette has none. */
export function recallEligibleAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  const elig = Object.keys(labels).filter((id) => labels[id] === "eligible");
  if (elig.length === 0) return Number.NaN;
  const top = new Set(ranked.slice(0, k));
  return elig.filter((id) => top.has(id)).length / elig.length;
}

/** Share of the top k (or of the whole list when shorter) judged excluded; NaN for an empty list. */
export function excludedShareAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  const top = ranked.slice(0, k);
  return top.length === 0 ? Number.NaN : top.filter((id) => labels[id] === "excluded").length / top.length;
}

/** True when the vignette has at least one relevant (eligible or possibly) judged trial: the TREC-style denominator. */
export function hasRelevant(labels: VignetteLabels): boolean {
  return Object.values(labels).some((l) => GAIN[l] > 0);
}

/**
 * Binary nDCG@k: gain 1 for every relevant label (eligible + possibly), or, with `eligibleOnly`, for eligible only.
 * NaN when nothing qualifies, so a mean over vignettes uses only the ones that can score.
 */
export function binaryNdcgAtK(ranked: readonly string[], labels: VignetteLabels, k: number, eligibleOnly = false): number {
  const rel = (id: string) => (labels[id] === undefined ? 0 : eligibleOnly ? (labels[id] === "eligible" ? 1 : 0) : GAIN[labels[id] as Label] > 0 ? 1 : 0);
  const n = Object.keys(labels).filter((id) => rel(id) === 1).length;
  if (n === 0) return Number.NaN;
  const dcg = ranked.slice(0, k).reduce((a, id, i) => a + rel(id) / Math.log2(i + 2), 0);
  let ideal = 0;
  for (let i = 0; i < Math.min(n, k); i++) ideal += 1 / Math.log2(i + 2);
  return dcg / ideal;
}

/** 1 when at least one relevant judged trial is in the top k, 0 when none is, NaN when the vignette has none at all. */
export function hitAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  if (!hasRelevant(labels)) return Number.NaN;
  return ranked.slice(0, k).some((id) => labels[id] !== undefined && GAIN[labels[id] as Label] > 0) ? 1 : 0;
}

/** Share of the top k that is relevant (eligible or possibly); NaN for an empty list. */
export function precisionRelevantAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  const top = ranked.slice(0, k);
  return top.length === 0 ? Number.NaN : top.filter((id) => labels[id] !== undefined && GAIN[labels[id] as Label] > 0).length / k;
}

/** Best P@k any order could reach: min(relevant judged, k) / k. NaN when the vignette has no relevant trial. */
export function precisionCeilingAtK(labels: VignetteLabels, k: number): number {
  const n = Object.values(labels).filter((l) => GAIN[l] > 0).length;
  return n === 0 ? Number.NaN : Math.min(n, k) / k;
}

/** Share of the top k that was never judged (pooling gap); NaN for an empty list. */
export function unjudgedShareAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  const top = ranked.slice(0, k);
  return top.length === 0 ? Number.NaN : top.filter((id) => labels[id] === undefined).length / top.length;
}

/** Condensed list (Sakai 2007): the ranking with unjudged trials removed, so a surfaced unjudged trial costs nothing. */
export function condensed(ranked: readonly string[], labels: VignetteLabels): string[] {
  return ranked.filter((id) => labels[id] !== undefined);
}

/** Recall of relevant (eligible + possibly) judged trials in the top k; NaN when the vignette has none. */
export function recallRelevantAtK(ranked: readonly string[], labels: VignetteLabels, k: number): number {
  const rel = Object.keys(labels).filter((id) => GAIN[labels[id] as Label] > 0);
  if (rel.length === 0) return Number.NaN;
  const top = new Set(ranked.slice(0, k));
  return rel.filter((id) => top.has(id)).length / rel.length;
}

/** Small deterministic PRNG (mulberry32) so bootstrap intervals are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const finite = (xs: readonly number[]) => xs.filter((x) => !Number.isNaN(x));
export const mean = (xs: readonly number[]) => {
  const f = finite(xs);
  return f.length ? f.reduce((a, b) => a + b, 0) / f.length : Number.NaN;
};

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

/**
 * Bootstrap 95% interval of the mean of per-vignette values (resampling vignettes). With `base` it is the paired
 * difference mean(values - base) resampled on the same vignette indices; NaN pairs are dropped.
 */
export function bootstrapCI(values: readonly number[], base?: readonly number[], iters = 2000, seed = 1): Interval {
  const idx = values.map((_, i) => i).filter((i) => !Number.isNaN(values[i] as number) && (!base || !Number.isNaN(base[i] as number)));
  const x = idx.map((i) => (values[i] as number) - (base ? (base[i] as number) : 0));
  if (x.length === 0) return { mean: Number.NaN, lo: Number.NaN, hi: Number.NaN, n: 0 };
  const rand = rng(seed);
  const means: number[] = [];
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[Math.floor(rand() * x.length)] as number;
    means.push(s / x.length);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(x), lo: means[Math.floor(0.025 * iters)] as number, hi: means[Math.ceil(0.975 * iters) - 1] as number, n: x.length };
}

/** Cohen's kappa between two aligned label arrays (unweighted). */
export function cohensKappa(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  if (n === 0) return Number.NaN;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
