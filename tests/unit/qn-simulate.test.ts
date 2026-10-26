import { describe, expect, it } from "vitest";
import { ndcgAt10, patientAnswer, runAdaptive, runFixed, samplePatient, simContext } from "@/lib/questionnaire/simulate";
import type { QuestionDef } from "@/lib/types/questionnaire";
import { essentials, makePool, rng, SKEWED_WEIGHTS, TEST_CATALOG } from "./qn-fixtures";

const N = 200;
const KS = [1, 2, 3, 4, 5, 6, 7];

function simulate(seed: number, weights?: readonly number[]) {
  const r = rng(seed);
  const rows: Array<{ adaptive: number[]; fixed: number[]; adaptiveConf: number[]; fixedConf: number[]; fullFixed: number; fullLen: number; quickLen: number; quickNdcg: number }> = [];
  for (let i = 0; i < N; i++) {
    const pool = makePool(seed * 1000 + i, 150, "lung", weights);
    const base = essentials("lung");
    const patient = samplePatient(r, base, TEST_CATALOG, "lung");
    const ctx = simContext(pool, TEST_CATALOG, base, patient);
    const full = runFixed(ctx, 99);
    const quick = runAdaptive(ctx, 99, "quick");
    const a = KS.map((k) => runAdaptive(ctx, k));
    const f = KS.map((k) => runFixed(ctx, k));
    rows.push({ adaptive: a.map((x) => x.ndcg), fixed: f.map((x) => x.ndcg), adaptiveConf: a.map((x) => x.conflictShare), fixedConf: f.map((x) => x.conflictShare), fullFixed: full.ndcg, fullLen: full.asked.length, quickLen: quick.asked.length, quickNdcg: quick.ndcg });
  }
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    adaptive: KS.map((_, j) => mean(rows.map((r) => r.adaptive[j]!))),
    fixed: KS.map((_, j) => mean(rows.map((r) => r.fixed[j]!))),
    adaptiveConf: KS.map((_, j) => mean(rows.map((r) => r.adaptiveConf[j]!))),
    fixedConf: KS.map((_, j) => mean(rows.map((r) => r.fixedConf[j]!))),
    fullFixed: mean(rows.map((r) => r.fullFixed)),
    fullLen: mean(rows.map((r) => r.fullLen)),
    quickLens: rows.map((r) => r.quickLen).sort((a, b) => a - b),
    quickNdcg: mean(rows.map((r) => r.quickNdcg)),
  };
}

describe("simulated patients: adaptive vs fixed (§7.2, test catalog + group-skewed synthetic pools)", { timeout: 120_000 }, () => {
  const res = simulate(5, SKEWED_WEIGHTS);
  const median = res.quickLens[N / 2]!;
  it("reports", () => {
    console.log(JSON.stringify({ ...res, quickLens: undefined, quickMedian: median }, (_, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v)));
  });
  it("adaptive beats fixed at every k <= 6 and matches it at 7", () => {
    for (let j = 0; j < 6; j++) expect(res.adaptive[j]!, `k=${KS[j]}`).toBeGreaterThan(res.fixed[j]!);
    expect(res.adaptive[6]!).toBeGreaterThanOrEqual(res.fixed[6]! - 0.01);
  });
  it("adaptive top 10 has fewer true conflicts than fixed for k = 2..5", () => {
    for (let j = 1; j < 5; j++) expect(res.adaptiveConf[j]!, `k=${KS[j]}`).toBeLessThan(res.fixedConf[j]!);
  });
  it("quick mode: median <= 6 questions on the synthetic pools (5 nationally) and better than the fixed flow of the same length", () => {
    expect(median).toBeLessThanOrEqual(6);
    expect(res.quickNdcg).toBeGreaterThan(res.fixed[median - 1]!);
    expect(res.quickNdcg).toBeGreaterThan(0.9 * res.fullFixed);
  });
});

describe("simulator helpers", () => {
  it("nDCG@10", () => {
    expect(ndcgAt10(["a", "b"], new Set(["a", "b"]))).toBe(1);
    expect(ndcgAt10(["x", "a"], new Set(["a"]))).toBeCloseTo(1 / Math.log2(3), 12);
    expect(ndcgAt10(["x"], new Set())).toBe(1);
  });
  it("patients answer the truth or don't know, by type", () => {
    const p = { truth: { spread: "metastatic" }, dontKnow: new Set(["treatments", "biomarkers"]) };
    const Q = (id: string) => TEST_CATALOG.find((q) => q.id === id) as QuestionDef;
    expect(patientAnswer(p, Q("spread"))).toBe("metastatic");
    expect(patientAnswer(p, Q("treatments"))).toEqual(["unknown"]);
    expect(patientAnswer(p, Q("biomarkers"))).toEqual({});
    expect(patientAnswer(p, Q("daily_activity"))).toBe("unknown");
  });
  it("samples options from priors, uniform without priors, and skips option-less questions", () => {
    const r = rng(1);
    const zeroPriors = TEST_CATALOG.map((q) => (q.id === "spread" ? ({ ...q, priors: { lung: { early: 0 } } } as unknown as QuestionDef) : q.id === "hiv" ? ({ ...q, options: [] } as unknown as QuestionDef) : q));
    const p = samplePatient(r, essentials(), zeroPriors, "lung");
    expect(p.truth.spread).toBeDefined();
    expect(p.truth.hiv).toBeUndefined();
    expect(p.truth.subtype).toBeDefined();
  });
});
