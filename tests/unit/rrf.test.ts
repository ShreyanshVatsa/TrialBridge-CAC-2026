import { describe, expect, it } from "vitest";
import { maxRrfScore, reciprocalRankFusion, RRF_K } from "@/lib/match/rrf";

describe("reciprocalRankFusion", () => {
  it("scores 1/(k+rank) summed across rankings", () => {
    const out = reciprocalRankFusion([["a", "b"], ["b", "a"]]);
    expect(out[0]?.score).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2), 12);
    expect(out.map((r) => r.ranks)).toEqual([[1, 2], [2, 1]]);
  });
  it("rewards agreement between methods", () => {
    const out = reciprocalRankFusion([["x", "both"], ["y", "both"]]);
    // "both" is rank 2 twice: 2/62 > 1/61 for x or y alone.
    expect(out[0]?.id).toBe("both");
  });
  it("handles items missing from a ranking", () => {
    const out = reciprocalRankFusion([["a"], ["b"]]);
    expect(out.find((r) => r.id === "a")?.ranks).toEqual([1, null]);
  });
  it("breaks ties deterministically by best rank then id", () => {
    const out = reciprocalRankFusion([["b", "a"], ["a", "b"]]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("ignores duplicates within one ranking", () => {
    const out = reciprocalRankFusion([["a", "a", "b"]]);
    expect(out.find((r) => r.id === "b")?.ranks).toEqual([3]);
    expect(out.find((r) => r.id === "a")?.score).toBeCloseTo(1 / (RRF_K + 1), 12);
  });
  it("uses configured k by default and validates k", () => {
    expect(RRF_K).toBe(20);
    expect(() => reciprocalRankFusion([["a"]], 0)).toThrow();
    expect(maxRrfScore(2)).toBeCloseTo(2 / (RRF_K + 1), 12);
  });
  it("returns empty for no input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
