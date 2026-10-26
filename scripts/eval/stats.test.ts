import { describe, expect, it } from "vitest";
import { bootstrapCI, pairedBootstrapCI, randomBaseline, rng, shuffled } from "./stats";
import { oracleAgeOk, oracleAgeYears, oracleGroupOk, oracleHaversine, oracleVerdict, tallyResults, emptyTally, type OracleStudy } from "./oracle";

describe("stats", () => {
  it("rng is deterministic and shuffle keeps the elements", () => {
    expect(rng(1)()).toBe(rng(1)());
    const xs = [1, 2, 3, 4, 5, 6];
    expect(shuffled(xs, rng(2)).sort()).toEqual(xs);
  });
  it("bootstrap CI brackets the mean and shrinks with more identical data", () => {
    const c = bootstrapCI([0.2, 0.4, 0.6, 0.8, NaN]);
    expect(c.n).toBe(4);
    expect(c.lo).toBeLessThanOrEqual(c.mean);
    expect(c.hi).toBeGreaterThanOrEqual(c.mean);
    expect(bootstrapCI([0.5, 0.5, 0.5]).lo).toBeCloseTo(0.5);
    expect(bootstrapCI([]).n).toBe(0);
  });
  it("paired CI excludes 0 for a consistent gain and includes it for noise", () => {
    const a = [0.9, 0.8, 0.85, 0.95, 0.7, 0.9];
    const b = a.map((x) => x - 0.1);
    expect(pairedBootstrapCI(a, b).lo).toBeGreaterThan(0);
    expect(pairedBootstrapCI([0.5, 0.6, 0.4, 0.5], [0.6, 0.5, 0.5, 0.4]).lo).toBeLessThan(0);
  });
  it("random baseline of top-1 hit rate equals the relevant share", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const rel = new Set(["t0", "t1", "t2"]);
    expect(randomBaseline(ids, (r) => (rel.has(r[0] as string) ? 1 : 0), rng(3), 4000)).toBeCloseTo(0.3, 1);
  });
});

const study = (over: Partial<OracleStudy> = {}): OracleStudy => ({ id: "NCT00000001", text: "breast cancer", minAgeYears: 18, maxAgeYears: null, sex: "ALL", locations: [{ status: "RECRUITING", country: "United States", geoPoint: { lat: 42.36, lon: -71.06 } }], ...over });

describe("independent oracle", () => {
  it("haversine matches a known distance (Boston to New York is about 190 mi)", () => {
    expect(oracleHaversine(42.36, -71.06, 40.71, -74.0)).toBeGreaterThan(185);
    expect(oracleHaversine(42.36, -71.06, 40.71, -74.0)).toBeLessThan(195);
  });
  it("parses ages in several units", () => {
    expect(oracleAgeYears("18 Years")).toBe(18);
    expect(oracleAgeYears("6 Months")).toBeCloseTo(0.5);
    expect(oracleAgeYears("N/A")).toBeNull();
    expect(oracleAgeOk({ minAgeYears: 18, maxAgeYears: 65 }, 17)).toBe(false);
    expect(oracleAgeOk({ minAgeYears: 18, maxAgeYears: 65 }, 66)).toBe(false);
    expect(oracleAgeOk({ minAgeYears: 18, maxAgeYears: 65 }, 65)).toBe(true);
  });
  it("group: specific terms, no cross-group leakage, baskets only for solid groups", () => {
    expect(oracleGroupOk("her2 positive breast cancer", "breast")).toBe(true);
    expect(oracleGroupOk("non-small cell lung cancer", "breast")).toBe(false);
    expect(oracleGroupOk("advanced solid tumors", "breast")).toBe(true);
    expect(oracleGroupOk("advanced solid tumors", "leukemia")).toBe(false);
    expect(oracleGroupOk("acute myeloid leukemia", "leukemia")).toBe(true);
    expect(oracleGroupOk("anything", "other")).toBe(true);
    // Sponsor keywords naming example indications do not stop a basket; the conditions/titles decide basket status.
    expect(oracleGroupOk("advanced solid tumors | esophageal adenocarcinoma", "lung", "advanced solid tumors")).toBe(true);
    expect(oracleGroupOk("advanced solid tumors | esophageal adenocarcinoma", "lung")).toBe(false);
    expect(oracleGroupOk("gall bladder cancer | breast cancer", "liver")).toBe(true);
    expect(oracleGroupOk("gall bladder cancer", "bladder")).toBe(false);
  });
  it("a record with no registry coordinates is unverifiable on distance, not a violation", () => {
    const noGeo = study({ locations: [{ status: "RECRUITING", country: "United States" }] });
    const v = oracleVerdict(noGeo, { group: "breast", age: 50, origin: { lat: 34.05, lon: -118.24 }, travelMiles: 10 });
    expect(v).toMatchObject({ distance: true, distanceUnverifiable: true });
  });
  it("verdict and tally flag a distance violation and an unverifiable id", () => {
    const raw = new Map([["NCT00000001", study()]]);
    const near = { group: "breast", age: 50, origin: { lat: 42.4, lon: -71.1 }, travelMiles: 50 };
    expect(oracleVerdict(study(), near)).toMatchObject({ group: true, age: true, distance: true, distanceStrict: true });
    const far = { ...near, origin: { lat: 34.05, lon: -118.24 } };
    expect(oracleVerdict(study(), far).distance).toBe(false);
    const t = emptyTally();
    tallyResults(t, raw, ["NCT00000001", "NCT99999999"], far);
    expect(t).toMatchObject({ results: 2, unverifiable: 1, distance: 1, any: 1 });
  });
});
