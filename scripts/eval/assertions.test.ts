import { describe, expect, it } from "vitest";
import { loadAssertionCases, runAssertions } from "./assertions";

describe("rule-layer assertions (eval/assertions.json)", () => {
  const cases = loadAssertionCases();
  const summary = runAssertions(cases);
  it("has a meaningful number of cases across sections", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    expect(new Set(cases.map((c) => c.section))).toEqual(new Set(["inclusion", "exclusion"]));
  });
  it("has no regressions on non-known cases", () => {
    expect(summary.failed.map((o) => ({ text: o.case.text, got: o.got }))).toEqual([]);
  });
  it("keeps the known-gap list honest (no stale flags)", () => {
    expect(summary.knownStale.map((o) => o.case.text)).toEqual([]);
  });
  it("detects mismatches", () => {
    const s = runAssertions([{ section: "exclusion", text: "Pregnancy", expect: {} }, { section: "exclusion", text: "Pregnancy", expect: {}, known: true }]);
    expect(s.failed).toHaveLength(1);
    expect(s.knownFailing).toHaveLength(1);
  });
});
