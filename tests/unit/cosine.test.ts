import { describe, expect, it } from "vitest";
import { cosineSimilarity, cosineSimilarityRow } from "@/lib/match/cosine";

describe("cosineSimilarity", () => {
  it("is 1 for identical direction regardless of length", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });
  it("is 0 for orthogonal vectors and -1 for opposite", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });
  it("matches the textbook formula on a known example", () => {
    // a·b = 4+10+18 = 32; |a| = sqrt(14); |b| = sqrt(77)
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(32 / Math.sqrt(14 * 77), 12);
  });
  it("returns 0 for a zero vector instead of NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
  it("throws on length mismatch", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/length mismatch/);
  });
  it("works on int8 quantized vectors (scale cancels out)", () => {
    const f = [0.6, -0.8];
    const q = Int8Array.from(f.map((v) => Math.round(v * 127)));
    expect(cosineSimilarity(Float32Array.from(f), q)).toBeCloseTo(1, 3);
  });
  it("row variant equals full cosine on that row", () => {
    const m = Int8Array.from([1, 0, 0, 3, 4, 0]);
    expect(cosineSimilarityRow([0, 1, 0], m, 1, 3)).toBeCloseTo(cosineSimilarity([0, 1, 0], [3, 4, 0]), 12);
    expect(cosineSimilarityRow([0, 0, 0], m, 0, 3)).toBe(0);
  });
});
