import { describe, expect, it } from "vitest";
import { CONFLICT_PENALTY, FIT_ADJUSTMENT, finalScore, MAX_COUNTED_CONFLICTS, normalizeRrf, precheckBonus, precheckPenalty, SUPPORT_BONUS } from "@/lib/match/score";
import type { PrecheckNote } from "@/lib/types/match";

const note = (kind: PrecheckNote["kind"]): PrecheckNote => ({ key: "pregnancy", kind, quote: "q", ref: { section: "exclusion", n: 1 } });

describe("score", () => {
  it("normalizes RRF to 0..1", () => {
    expect(normalizeRrf(2 / 21, 2)).toBeCloseTo(1, 12);
    expect(normalizeRrf(1 / 21, 2)).toBeCloseTo(0.5, 12);
    expect(normalizeRrf(1, 0)).toBe(0);
  });
  it("caps conflict penalties", () => {
    const many = Array.from({ length: 10 }, () => note("conflict"));
    expect(precheckPenalty(many)).toBeCloseTo(CONFLICT_PENALTY * MAX_COUNTED_CONFLICTS, 12);
    expect(precheckBonus([note("support")])).toBeCloseTo(SUPPORT_BONUS, 12);
  });
  it("combines retrieval, pre-check and AI fit", () => {
    const s = finalScore({ retrieval: 0.8, precheck: [note("conflict"), note("support")], fit: "strong" });
    expect(s).toBeCloseTo(0.8 - CONFLICT_PENALTY + SUPPORT_BONUS + FIT_ADJUSTMENT.strong, 12);
    expect(finalScore({ retrieval: 0.5, precheck: [], fit: null })).toBe(0.5);
  });
  it("orders fit levels strong > possible > unclear > unlikely", () => {
    const f = (fit: keyof typeof FIT_ADJUSTMENT) => finalScore({ retrieval: 0.5, precheck: [], fit });
    expect(f("strong")).toBeGreaterThan(f("possible"));
    expect(f("possible")).toBeGreaterThan(f("unclear"));
    expect(f("unclear")).toBeGreaterThan(f("unlikely"));
  });
});
