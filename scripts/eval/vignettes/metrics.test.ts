import { describe, expect, it } from "vitest";
import { binaryNdcgAtK, bootstrapCI, cohensKappa, condensed, excludedShareAtK, hasRelevant, hitAtK, ndcgAtK, precisionCeilingAtK, precisionRelevantAtK, recallEligibleAtK, recallRelevantAtK, rng, unjudgedShareAtK } from "./metrics";

const labels = { A: "eligible", B: "possibly", C: "excluded", D: "not_relevant", E: "eligible" } as const;

describe("ndcgAtK", () => {
  it("is 1 for the ideal order and 0 for none relevant", () => {
    expect(ndcgAtK(["A", "E", "B", "C", "D"], labels, 10)).toBeCloseTo(1, 10);
    expect(ndcgAtK(["C", "D"], labels, 10)).toBe(0);
    expect(ndcgAtK(["A"], { A: "excluded" }, 10)).toBe(0);
  });
  it("discounts by log2(rank+1) and treats unjudged ids as gain 0", () => {
    // ranking [B, A]: dcg = 2/1 + 3/log2(3); ideal [A,E,B]: 3 + 3/log2(3) + 2/2
    const dcg = 2 + 3 / Math.log2(3);
    const ideal = 3 + 3 / Math.log2(3) + 2 / 2;
    expect(ndcgAtK(["B", "A"], labels, 10)).toBeCloseTo(dcg / ideal, 10);
    expect(ndcgAtK(["X", "A"], labels, 10)).toBeCloseTo(3 / Math.log2(3) / ideal, 10);
  });
  it("only counts the top k", () => {
    expect(ndcgAtK(["C", "A"], labels, 1)).toBe(0);
  });
});

describe("recall and excluded share", () => {
  it("recall of eligible at k", () => {
    expect(recallEligibleAtK(["A", "C", "E"], labels, 2)).toBe(0.5);
    expect(recallEligibleAtK(["A", "C", "E"], labels, 50)).toBe(1);
    expect(recallEligibleAtK(["A"], { A: "possibly" }, 5)).toBeNaN();
  });
  it("excluded share of the top k, over the list length when shorter", () => {
    expect(excludedShareAtK(["C", "A", "D", "B"], labels, 2)).toBe(0.5);
    expect(excludedShareAtK(["C"], labels, 10)).toBe(1);
    expect(excludedShareAtK([], labels, 10)).toBeNaN();
  });
});

describe("bootstrapCI", () => {
  it("is deterministic and brackets the mean", () => {
    const xs = Array.from({ length: 60 }, (_, i) => (i % 10) / 10);
    const a = bootstrapCI(xs);
    expect(bootstrapCI(xs)).toEqual(a);
    expect(a.lo).toBeLessThanOrEqual(a.mean);
    expect(a.hi).toBeGreaterThanOrEqual(a.mean);
    expect(a.n).toBe(60);
  });
  it("paired difference excludes 0 for a consistent gain and ignores NaN pairs", () => {
    const base = Array.from({ length: 40 }, (_, i) => 0.3 + (i % 5) * 0.05);
    const better = base.map((x) => x + 0.1);
    const d = bootstrapCI([...better, Number.NaN], [...base, 0.5]);
    expect(d.mean).toBeCloseTo(0.1, 10);
    expect(d.lo).toBeGreaterThan(0.09);
    expect(d.n).toBe(40);
  });
  it("rng is reproducible", () => {
    expect(rng(7)()).toBe(rng(7)());
  });
});

describe("cohensKappa", () => {
  it("is 1 for identical, 0 for chance-level and handles single category", () => {
    expect(cohensKappa(["a", "b", "a", "b"], ["a", "b", "a", "b"])).toBe(1);
    expect(cohensKappa(["a", "a", "b", "b"], ["a", "b", "a", "b"])).toBeCloseTo(0, 10);
    expect(cohensKappa(["a", "a"], ["a", "a"])).toBe(1);
  });
});

describe("v9 reporting metrics", () => {
  const none = { C: "excluded", D: "not_relevant" } as const;
  it("hasRelevant splits the two denominators", () => {
    expect(hasRelevant(labels)).toBe(true);
    expect(hasRelevant(none)).toBe(false);
  });
  it("binary nDCG counts eligible and possibly as 1, or eligible only", () => {
    expect(binaryNdcgAtK(["B", "A", "E"], labels, 10)).toBeCloseTo(1, 10);
    const ideal = 1 + 1 / Math.log2(3);
    expect(binaryNdcgAtK(["B", "A", "E"], labels, 10, true)).toBeCloseTo((1 / Math.log2(3) + 1 / Math.log2(4)) / ideal, 10);
    expect(binaryNdcgAtK(["C"], none, 10)).toBeNaN();
  });
  it("hit@k is NaN without a relevant trial", () => {
    expect(hitAtK(["C", "D", "B"], labels, 2)).toBe(0);
    expect(hitAtK(["C", "D", "B"], labels, 3)).toBe(1);
    expect(hitAtK(["C"], none, 10)).toBeNaN();
  });
  it("P@k divides by k, its ceiling is min(relevant, k)/k", () => {
    expect(precisionRelevantAtK(["A", "C"], labels, 10)).toBeCloseTo(0.1, 10);
    expect(precisionCeilingAtK(labels, 10)).toBeCloseTo(0.3, 10);
    expect(precisionCeilingAtK(labels, 2)).toBe(1);
    expect(precisionCeilingAtK(none, 10)).toBeNaN();
  });
  it("unjudged share and condensed lists drop never-pooled ids", () => {
    expect(unjudgedShareAtK(["X", "A", "Y", "C"], labels, 10)).toBe(0.5);
    expect(condensed(["X", "A", "Y", "C"], labels)).toEqual(["A", "C"]);
    expect(ndcgAtK(condensed(["X", "A", "E", "B"], labels), labels, 10)).toBeCloseTo(1, 10);
  });
  it("recall of relevant trials", () => {
    expect(recallRelevantAtK(["A", "C"], labels, 10)).toBeCloseTo(1 / 3, 10);
    expect(recallRelevantAtK(["C"], none, 10)).toBeNaN();
  });
});
