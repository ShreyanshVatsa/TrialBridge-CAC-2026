/** Eval statistics: seeded RNG, random-ranking baseline, percentile and paired bootstrap confidence intervals. */

/** mulberry32: small deterministic PRNG so every reported number reproduces. */
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

/** Fisher-Yates shuffle of a copy. */
export function shuffled<T>(xs: readonly T[], rand: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Mean of a metric over `draws` random permutations of the candidate list (the expected score of ranking at random). */
export function randomBaseline(candidates: readonly string[], metric: (ranked: string[]) => number, rand: () => number, draws = 200): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < draws; i++) {
    const v = metric(shuffled(candidates, rand));
    if (Number.isNaN(v)) return NaN;
    sum += v;
    n++;
  }
  return n ? sum / n : NaN;
}

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface CI {
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

function percentile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

/** Percentile bootstrap 95% CI of the mean over profiles (NaN entries, e.g. profiles without labels, are dropped). */
export function bootstrapCI(values: readonly number[], seed = 20261012, resamples = 4000): CI {
  const v = values.filter((x) => !Number.isNaN(x));
  if (!v.length) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const rand = rng(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(rand() * v.length)] as number;
    means.push(s / v.length);
  }
  means.sort((a, b) => a - b);
  return { mean: meanOf(v), lo: percentile(means, 0.025), hi: percentile(means, 0.975), n: v.length };
}

/** Paired bootstrap 95% CI of mean(a - b): profiles are resampled together, so profile difficulty cancels. */
export function pairedBootstrapCI(a: readonly number[], b: readonly number[], seed = 20261012, resamples = 4000): CI {
  const d: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const x = (a[i] as number) - (b[i] as number);
    if (!Number.isNaN(x)) d.push(x);
  }
  return bootstrapCI(d, seed, resamples);
}

export const fmtCI = (c: CI): string => (c.n ? `${c.mean.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}]` : "n/a");
/** Signed difference with its interval, plus a plain-words verdict on whether the interval excludes 0. */
/** `lowerIsBetter` for metrics such as missed exclusions, where a negative difference is the improvement. */
export const fmtDiff = (c: CI, lowerIsBetter = false): string =>
  c.n ? `${c.mean >= 0 ? "+" : ""}${c.mean.toFixed(3)} [${c.lo.toFixed(3)}, ${c.hi.toFixed(3)}] (${c.lo > 0 ? `excludes 0, ${lowerIsBetter ? "worse" : "better"}` : c.hi < 0 ? `excludes 0, ${lowerIsBetter ? "better" : "worse"}` : "includes 0, not distinguishable"})` : "n/a";
