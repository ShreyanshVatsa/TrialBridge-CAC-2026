/**
 * Offline fitting and scoring of the fusion weights (lib/match/fusion.ts). A "query" is one ranking problem: the
 * candidates' feature vectors (computed by the real pipeline, independent of the weights) and the graded gains of the
 * judged candidates. Everything here is pure: no files, no models. Training data must be dev-split queries only; the
 * caller is responsible for never passing test queries to `fitWeights` (scripts/eval/vignettes/fit.ts enforces it).
 */
import { fusedScore, FUSION_WEIGHTS, type Features, type FusionWeights } from "../../lib/match/fusion";

export interface FitRow {
  id: string;
  f: Features;
}
export interface FitQuery {
  id: string;
  rows: FitRow[];
  /** Graded gain per judged candidate id (absent = unjudged = 0). */
  gains: Readonly<Record<string, number>>;
}

/** Order candidate ids by fused score (ties: id), best first. */
export function rankIds(q: FitQuery, w: FusionWeights): string[] {
  return q.rows
    .map((r) => ({ id: r.id, s: fusedScore(r.f, null, w) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

/** Graded nDCG@k with the log2(rank+1) discount; ideal from all judged gains of the query. */
export function ndcgAt(ranked: readonly string[], gains: Readonly<Record<string, number>>, k = 10): number {
  const d = (i: number) => 1 / Math.log2(i + 2);
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) dcg += (gains[ranked[i] ?? ""] ?? 0) * d(i);
  const ideal = Object.values(gains)
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);
  let idcg = 0;
  ideal.forEach((g, i) => (idcg += g * d(i)));
  return idcg === 0 ? NaN : dcg / idcg;
}

export function meanNdcg(qs: readonly FitQuery[], w: FusionWeights, k = 10): number {
  const v = qs.map((q) => ndcgAt(rankIds(q, w), q.gains, k)).filter((x) => !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

export function perQueryNdcg(qs: readonly FitQuery[], w: FusionWeights, k = 10): number[] {
  return qs.map((q) => ndcgAt(rankIds(q, w), q.gains, k));
}

/** Feature -> allowed sign (+1 weight >= 0, -1 weight <= 0, 0 free). Keeps the fit interpretable and monotone. */
export const SIGNS: Readonly<Record<keyof Features, 1 | -1 | 0>> = {
  retrieval: 1,
  kw: 1,
  vec: 1,
  cosine: 1,
  bm25: 1,
  penalty: -1,
  bonus: 1,
  phase: 0,
  subtypeMatch: 1,
  subtypeConflict: -1,
  basket: 0,
  weakGroup: 0,
  extentConflict: -1,
};

export interface FitOptions {
  /** Features allowed to move (others keep their starting weight). */
  free: readonly (keyof Features)[];
  passes?: number;
  /** Candidate multipliers tried per coordinate, relative to a per-feature scale. */
  grid?: readonly number[];
  /** Ties and near-ties (within `eps`) prefer the smaller change from `start` (a mild L1 pull). */
  eps?: number;
  start?: FusionWeights;
}

const SCALE: Partial<Record<keyof Features, number>> = { retrieval: 1, kw: 1, vec: 1, cosine: 4, bm25: 1, penalty: 1, bonus: 4, phase: 1, subtypeMatch: 0.3, subtypeConflict: 0.5, basket: 0.3, weakGroup: 0.3 };

/** Coordinate ascent on mean nDCG@10. Deterministic. */
export function fitWeights(train: readonly FitQuery[], opts: FitOptions): FusionWeights {
  const grid = opts.grid ?? [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3];
  const eps = opts.eps ?? 0.0005;
  const start = opts.start ?? FUSION_WEIGHTS;
  let w: Record<string, number> = { ...start };
  let best = meanNdcg(train, w as FusionWeights);
  for (let pass = 0; pass < (opts.passes ?? 3); pass++) {
    let moved = false;
    for (const k of opts.free) {
      const sign = SIGNS[k];
      const scale = SCALE[k] ?? 1;
      const cands = new Set<number>([w[k] as number]);
      for (const g of grid) {
        const v = g * scale;
        if (sign >= 0) cands.add(v);
        if (sign <= 0) cands.add(-v);
      }
      let bestV = w[k] as number;
      let bestS = best;
      for (const v of [...cands].sort((a, b) => Math.abs(a - (start[k] ?? 0)) - Math.abs(b - (start[k] ?? 0)) || a - b)) {
        const s = meanNdcg(train, { ...w, [k]: v } as FusionWeights);
        if (s > bestS + eps) {
          bestS = s;
          bestV = v;
        }
      }
      if (bestV !== w[k]) {
        w = { ...w, [k]: bestV };
        best = bestS;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return w as FusionWeights;
}

/** k-fold (or leave-one-out when folds >= n) cross-validated mean nDCG@10 of `fitWeights`, plus per-query scores. */
export function crossValidate(qs: readonly FitQuery[], opts: FitOptions, folds = 5): { mean: number; perQuery: number[]; weights: FusionWeights[] } {
  const n = qs.length;
  const f = Math.min(folds, n);
  const per: number[] = new Array<number>(n).fill(NaN);
  const ws: FusionWeights[] = [];
  for (let fold = 0; fold < f; fold++) {
    const test = qs.filter((_, i) => i % f === fold);
    const train = qs.filter((_, i) => i % f !== fold);
    const w = fitWeights(train, opts);
    ws.push(w);
    test.forEach((q) => (per[qs.indexOf(q)] = ndcgAt(rankIds(q, w), q.gains)));
  }
  const v = per.filter((x) => !Number.isNaN(x));
  return { mean: v.reduce((a, b) => a + b, 0) / Math.max(1, v.length), perQuery: per, weights: ws };
}

/** Percentile bootstrap CI of the mean of `xs` (ignores NaN). Deterministic LCG. */
export function bootstrapCi(xs: readonly number[], iters = 2000, seed = 12345): { mean: number; lo: number; hi: number } {
  const v = xs.filter((x) => !Number.isNaN(x));
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const means: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < v.length; j++) sum += v[Math.floor(rnd() * v.length)] as number;
    means.push(sum / v.length);
  }
  means.sort((a, b) => a - b);
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, lo: means[Math.floor(0.025 * iters)] as number, hi: means[Math.floor(0.975 * iters)] as number };
}

/** Paired bootstrap CI of mean(a - b) over queries (NaN pairs dropped). */
export function pairedBootstrapCi(a: readonly number[], b: readonly number[], iters = 2000, seed = 777): { mean: number; lo: number; hi: number } {
  const d = a.map((x, i) => x - (b[i] as number)).filter((x) => !Number.isNaN(x));
  return bootstrapCi(d, iters, seed);
}
