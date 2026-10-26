import { describe, expect, it } from "vitest";
import { precheck } from "@/lib/match/precheck";
import { fact, makeAnswers } from "./fixtures";

const kinds = (a: Parameters<typeof precheck>[0], f: Parameters<typeof precheck>[1]) => precheck(a, f).map((n) => `${n.key}:${n.kind}`);

describe("precheck", () => {
  it("treatment history conflicts and supports", () => {
    const a = makeAnswers({ treatments: ["chemotherapy"] });
    expect(kinds(a, [fact("prior_chemotherapy", "excluded", "exclusion")])).toEqual(["prior_chemotherapy:conflict"]);
    expect(kinds(a, [fact("prior_chemotherapy", "required")])).toEqual(["prior_chemotherapy:support"]);
    expect(kinds(a, [fact("prior_radiation", "required")])).toEqual(["prior_radiation:conflict"]);
  });
  it("never penalizes not sure / don't know / mentioned", () => {
    const a = makeAnswers({ treatments: ["not_sure"], spread: "not_sure", pregnant: "not_sure", biomarkers: { HER2: "dont_know" } });
    const facts = [fact("prior_chemotherapy", "required"), fact("metastatic", "required"), fact("pregnancy", "excluded"), fact("biomarker:HER2", "required"), fact("newly_diagnosed", "required"), fact("previously_treated", "required")];
    expect(precheck(a, facts)).toEqual([]);
    expect(precheck(makeAnswers({ treatments: ["chemotherapy"] }), [fact("prior_chemotherapy", "mentioned")])).toEqual([]);
    expect(precheck(makeAnswers({ pregnant: "prefer_not" }), [fact("pregnancy", "excluded")])).toEqual([]);
  });
  it("metastatic status", () => {
    expect(kinds(makeAnswers({ spread: "yes" }), [fact("metastatic", "excluded", "exclusion")])).toEqual(["metastatic:conflict"]);
    expect(kinds(makeAnswers({ spread: "yes" }), [fact("metastatic", "required")])).toEqual(["metastatic:support"]);
    expect(kinds(makeAnswers({ spread: "no" }), [fact("metastatic", "required")])).toEqual(["metastatic:conflict"]);
    expect(kinds(makeAnswers({ spread: "no" }), [fact("metastatic", "excluded")])).toEqual([]);
  });
  it("newly diagnosed vs previously treated", () => {
    expect(kinds(makeAnswers({ treatments: ["surgery"] }), [fact("newly_diagnosed", "required")])).toEqual(["newly_diagnosed:conflict"]);
    expect(kinds(makeAnswers({ treatments: ["none"] }), [fact("newly_diagnosed", "required")])).toEqual(["newly_diagnosed:support"]);
    expect(kinds(makeAnswers({ treatments: ["none"] }), [fact("previously_treated", "required")])).toEqual(["previously_treated:conflict"]);
    expect(kinds(makeAnswers({ treatments: ["radiation"] }), [fact("previously_treated", "required")])).toEqual(["previously_treated:support"]);
  });
  it("pregnancy and concurrent trial", () => {
    expect(kinds(makeAnswers({ pregnant: "yes" }), [fact("pregnancy", "excluded")])).toEqual(["pregnancy:conflict"]);
    expect(kinds(makeAnswers({ inAnotherTrial: "yes" }), [fact("concurrent_trial", "excluded")])).toEqual(["concurrent_trial:conflict"]);
    expect(kinds(makeAnswers(), [fact("concurrent_trial", "excluded"), fact("pregnancy", "excluded")])).toEqual([]);
  });
  it("biomarker logic", () => {
    expect(kinds(makeAnswers({ biomarkers: { HER2: "positive" } }), [fact("biomarker:HER2", "required")])).toEqual(["biomarker:HER2:support"]);
    expect(kinds(makeAnswers({ biomarkers: { HER2: "positive" } }), [fact("biomarker:HER2", "excluded")])).toEqual(["biomarker:HER2:conflict"]);
    expect(kinds(makeAnswers({ biomarkers: { HER2: "negative" } }), [fact("biomarker:HER2", "required")])).toEqual(["biomarker:HER2:conflict"]);
    expect(kinds(makeAnswers({ biomarkers: { HER2: "negative" } }), [fact("biomarker:HER2", "excluded")])).toEqual([]);
    expect(kinds(makeAnswers({ biomarkers: {} }), [fact("biomarker:EGFR", "required")])).toEqual([]);
  });
});
