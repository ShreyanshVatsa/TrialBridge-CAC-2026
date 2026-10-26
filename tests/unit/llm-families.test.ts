import { describe, expect, it } from "vitest";
import {
  applyLlmLayer,
  buildFamilyMessages,
  combineFamily,
  committedByKey,
  compactCriteria,
  decisionProbs,
  drugClassesIn,
  familyKeys,
  familySchema,
  histologyIdsIn,
  keyCarvedOut,
  paramInconsistent,
  familyCacheKey,
  histologyIdsFor,
  markerIdsIn,
  numberInQuote,
  parseFamilyOutput,
  relevantFamilies,
  underCohortHeader,
  verifyFamilyFacts,
  type CheckedFact,
  type LlmTrialText,
  type RawLlmFact,
} from "@/lib/ingest/llm-families";
import type { Fact } from "@/lib/types/trial";

const trial = (over: Partial<LlmTrialText> = {}): LlmTrialText => ({
  id: "NCT00000001",
  lastUpdated: "2026-01-01",
  groups: ["lung"],
  conditions: ["Non-small Cell Lung Cancer"],
  inclusion: [
    { n: 1, text: "Histologically confirmed non-small cell lung cancer" },
    { n: 2, text: "Must have received at least 2 prior lines of systemic therapy" },
    { n: 3, text: "Part B only:" },
    { n: 4, text: "Must have received at least 1 prior line of therapy" },
  ],
  exclusion: [
    { n: 1, text: "Prior treatment with a CDK4/6 inhibitor" },
    { n: 2, text: "History of another malignancy within the past 3 years, except treated basal cell carcinoma" },
    { n: 3, text: "Active hepatitis B or hepatitis C infection" },
    { n: 4, text: "Prior chemotherapy within 4 weeks of enrollment" },
    { n: 5, text: "History of autoimmune disease" },
  ],
  ...over,
});

const raw = (over: Partial<RawLlmFact>): RawLlmFact => ({ key: "min_prior_lines", value: "required", scope: "all", ref: "I2", quote: "at least 2 prior lines of systemic therapy", lp: 0.99, ...over });
const ruleFact = (over: Partial<Fact>): Fact => ({ key: "min_prior_lines", value: "required", param: 2, quote: "q", ref: { section: "inclusion", n: 2 }, source: "rule", ...over });

describe("v2 LLM layer: prompts and selection", () => {
  it("sends only public trial text and shares one prefix across a trial's families", () => {
    const t = trial();
    const a = buildFamilyMessages("lines", t, ["lines", "hepatitis"]);
    const b = buildFamilyMessages("hepatitis", t, ["lines", "hepatitis"]);
    const prefix = (m: { content: string }[]) => (m[1]?.content ?? "").split("TASK:")[0];
    expect(prefix(a)).toBe(prefix(b));
    expect(a[1]?.content).toContain("I2. Must have received at least 2 prior lines");
    expect(a[1]?.content).toContain("/no_think");
    // No patient-shaped fields exist in the input type; the prompt is built from criteria + conditions only.
    expect(Object.keys(t).sort()).toEqual(["conditions", "exclusion", "groups", "id", "inclusion", "lastUpdated"]);
  });
  it("compacts criteria to keyword + header + diagnosis lines, keeping original numbering", () => {
    const t = trial({ exclusion: [{ n: 1, text: "Pregnant or breastfeeding" }, { n: 2, text: "Known hepatitis B infection" }] });
    const c = compactCriteria(t, ["hepatitis"]);
    expect(c.exclusion.map((x) => x.n)).toEqual([2]);
    expect(c.inclusion.map((x) => x.n)).toEqual([1, 2, 3]);
    expect(c.omitted).toBe(2);
    const msg = buildFamilyMessages("hepatitis", t, ["hepatitis"])[1]?.content ?? "";
    expect(msg).toContain("criteria unrelated to the task are omitted");
  });
  it("selects families by keyword or rule facts and narrows id lists", () => {
    const t = trial();
    const fams = relevantFamilies(t, []);
    expect(fams).toEqual(expect.arrayContaining(["lines", "prior_drug", "other_malignancy", "hepatitis", "histology", "autoimmune"]));
    expect(fams).not.toContain("biomarker_v2");
    expect(relevantFamilies(trial({ groups: ["breast"], inclusion: [], exclusion: [] }), [], ["histology"])).toEqual([]);
    expect(relevantFamilies(trial({ inclusion: [], exclusion: [] }), [ruleFact({ key: "recurrent", value: "mentioned" })], ["recurrent"])).toEqual(["recurrent"]);
    expect(histologyIdsFor(["lung"])).toContain("sclc");
    expect(markerIdsIn("MET exon 14 and RET fusion")).toEqual(["MET", "RET"]);
    expect(drugClassesIn("prior palbociclib")).toEqual(["cdk46"]);
    expect(buildFamilyMessages("biomarker_v2", trial({ inclusion: [{ n: 1, text: "RET fusion" }] }))[1]?.content).toContain("RET: RET");
    expect(familyCacheKey("NCT1", "2026-01-01", "lines")).toMatch(/^NCT1\|2026-01-01\|lv2-\d+\|lines$/);
  });
});

describe("v2 LLM layer: parsing", () => {
  it("parses JSON (stripping <think>), validates each fact, and throws without JSON", () => {
    const out = parseFamilyOutput(`<think>x</think>{"facts":[{"key":"recurrent","value":"required","scope":"all","ref":"I1","quote":"relapsed disease"},{"key":"x","value":"maybe"}]}`);
    expect(out.facts).toHaveLength(1);
    expect(out.invalid).toBe(1);
    expect(() => parseFamilyOutput("nope")).toThrow();
  });
  it("reads token probabilities of the decisive fields", () => {
    const content = `{"facts":[{"key":"a","scope":"all","value":"required"}]}`;
    const tokens = [...content].map((ch, i) => ({ token: ch, logprob: content.slice(0, i).endsWith('"value":"') ? Math.log(0.6) : 0 }));
    const p = decisionProbs(content, tokens);
    expect(p).toHaveLength(1);
    expect(p[0]).toBeCloseTo(0.6, 5);
    expect(decisionProbs(`{"facts":[]}`, [])).toEqual([]);
  });
});

describe("v2 LLM layer: hard verification", () => {
  const t = trial();
  const v = (family: Parameters<typeof verifyFamilyFacts>[0], f: Partial<RawLlmFact>) => verifyFamilyFacts(family, [raw(f)], t, { minConfidence: 0.9 })[0];
  it("commits a verbatim, whole-trial, confident fact with its quote and criterion", () => {
    const c = v("lines", { param: 2 });
    expect(c?.committed).toBe(true);
    expect(c?.ref).toEqual({ section: "inclusion", n: 2 });
    expect(c?.param).toBe(2);
  });
  it("drops quotes that are not verbatim inside one criterion (paraphrase or joined criteria)", () => {
    expect(v("lines", { param: 2, quote: "at least two prior lines of systemic therapy" })).toBeUndefined();
    expect(v("lines", { param: 2, quote: "histologically confirmed non-small cell lung cancer Must have received" })).toBeUndefined();
    expect(v("lines", { param: 2, quote: "short" })).toBeUndefined();
    expect(v("lines", { param: 2, quote: undefined })).toBeUndefined();
    expect(v("lines", { key: "biomarker:MET" })).toBeUndefined();
  });
  it("abstains (mentioned) on cohort, alternatives, unclear, cohort headers and low confidence", () => {
    expect(v("lines", { param: 2, scope: "cohort" })).toMatchObject({ value: "mentioned", committed: false, reason: "scope_cohort" });
    expect(v("lines", { param: 2, scope: "unclear" })?.reason).toBe("scope_unclear");
    expect(v("lines", { param: 2, scope: undefined })?.reason).toBe("scope_missing");
    expect(v("lines", { param: 1, ref: "I4", quote: "at least 1 prior line of therapy" })?.reason).toBe("cohort_context");
    expect(v("lines", { param: 2, lp: 0.5 })?.reason).toBe("low_confidence");
    expect(v("lines", { param: 2, lp: undefined, confidence: 0.95 })?.committed).toBe(true);
    expect(v("lines", { value: "mentioned" })?.reason).toBe("model_mentioned");
  });
  it("checks refs, params written in the quote, keywords and family-specific traps", () => {
    expect(v("lines", { param: 2, ref: "E1" })?.reason).toBe("ref_mismatch");
    expect(v("lines", { param: 3 })?.reason).toBe("param_not_in_quote");
    expect(v("lines", { param: undefined })?.reason).toBe("bad_param");
    expect(v("lines", { param: 2, value: "excluded" })?.reason).toBe("bad_value");
    const drug = { key: "prior_drug:cdk46", value: "excluded" as const, ref: "E1", quote: "Prior treatment with a CDK4/6 inhibitor" };
    expect(v("prior_drug", { ...drug, time: "ever", class_level: true })?.committed).toBe(true);
    expect(v("prior_drug", { ...drug, time: "window" })?.reason).toBe("time_window");
    expect(v("prior_drug", { ...drug, class_level: false })?.reason).toBe("single_drug");
    expect(v("prior_drug", { ...drug, value: "required", time: "current" })?.reason).toBe("time_current");
    expect(v("prior_drug", { ...drug, key: "prior_drug:parp" })?.reason).toBe("quote_off_topic");
    const om = { key: "other_malignancy", value: "excluded" as const, ref: "E2", quote: "History of another malignancy within the past 3 years" };
    expect(v("other_malignancy", { ...om, param: 3 })).toMatchObject({ committed: true, param: 3 });
    expect(v("other_malignancy", { ...om, param: 5 })?.reason).toBe("param_not_in_quote");
    expect(v("other_malignancy", { ...om, param: "active_only" })?.param).toBe("active_only");
    expect(v("other_malignancy", { ...om, param: "weird" })?.reason).toBe("bad_param");
    expect(v("other_malignancy", { ...om, param: 3, value: "required" })?.reason).toBe("bad_value");
    const hep = { value: "excluded" as const, ref: "E3", quote: "Active hepatitis B or hepatitis C infection", param: "active_only" };
    expect(v("hepatitis", { ...hep, key: "hepatitis_b" })?.committed).toBe(true);
    expect(v("hepatitis", { ...hep, key: "hepatitis_c" })?.committed).toBe(true);
    expect(v("autoimmune", { key: "autoimmune", value: "excluded", ref: "E5", quote: "History of autoimmune disease" })).toMatchObject({ committed: true });
    expect(v("autoimmune", { key: "autoimmune", value: "required", ref: "E5", quote: "History of autoimmune disease" })?.reason).toBe("bad_value");
    expect(v("histology", { key: "histology:nsclc", ref: "I1", quote: "Histologically confirmed non-small cell lung cancer" })?.committed).toBe(true);
    expect(v("histology", { key: "histology:aml", ref: "I1", quote: "Histologically confirmed non-small cell lung cancer" })).toBeUndefined();
  });
  it("number words count as written params", () => {
    expect(numberInQuote(2, "at least two prior regimens")).toBe(true);
    expect(numberInQuote(2, "at least 12 prior regimens")).toBe(false);
    expect(numberInQuote(1, "a single prior line")).toBe(true);
  });
  it("finds alternatives / cohort headers above a criterion", () => {
    const list = [
      { n: 1, text: "Cohort A:" },
      { n: 2, text: "at least 2 prior lines" },
      { n: 3, text: "Adults" },
    ];
    expect(underCohortHeader(list, 2)).toBe(true);
    expect(underCohortHeader([{ n: 1, text: "Adults" }, { n: 2, text: "x" }], 2)).toBe(false);
    expect(underCohortHeader([{ n: 1, text: "Laboratory values:" }, { n: 2, text: "x" }], 2)).toBe(false);
  });
});

describe("v2 LLM layer: agreement policy with the rule layer", () => {
  const ck = (over: Partial<CheckedFact>): CheckedFact => ({ key: "min_prior_lines", value: "required", param: 2, quote: "at least 2", ref: { section: "inclusion", n: 2 }, confidence: 0.97, committed: true, ...over });
  it("rules agree => one directional fact (LLM confidence attached)", () => {
    const out = combineFamily([ruleFact({})], [ck({})]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ value: "required", param: 2, source: "rule", confidence: 0.97 });
  });
  it("rules none or mentioned => the LLM fact is committed", () => {
    expect(combineFamily([], [ck({})])[0]).toMatchObject({ value: "required", source: "llm" });
    expect(combineFamily([ruleFact({ value: "mentioned", param: undefined })], [ck({})])[0]).toMatchObject({ value: "required", source: "llm" });
  });
  it("disagreement (direction or param) => both kept, needsReview, never committed", () => {
    const out = combineFamily([ruleFact({ param: 1 })], [ck({})]);
    expect(out).toHaveLength(2);
    expect(out.every((f) => f.needsReview)).toBe(true);
  });
  it("abstention => rule directional fact demoted to mentioned; rule mentioned unchanged", () => {
    expect(combineFamily([ruleFact({})], [ck({ committed: false, value: "mentioned" })])[0]?.value).toBe("mentioned");
    expect(combineFamily([ruleFact({ value: "mentioned" })], [])[0]?.value).toBe("mentioned");
  });
  it("LLM facts for one key: opposite directions cancel; same direction keeps the most lenient param", () => {
    expect(committedByKey([ck({}), ck({ value: "excluded" as const })]).size).toBe(0);
    expect(committedByKey([ck({ param: 2 }), ck({ param: 1 })]).get("min_prior_lines")?.param).toBe(1);
    const om = (p?: number | string) => ck({ key: "other_malignancy", value: "excluded", ...(p === undefined ? { param: undefined } : { param: p }) });
    expect(committedByKey([om(), om(3)]).get("other_malignancy")?.param).toBe(3);
    expect(committedByKey([om(3), om()]).get("other_malignancy")?.param).toBe(3);
    expect(committedByKey([om(3), om("active_only")]).get("other_malignancy")?.param).toBe("active_only");
    expect(committedByKey([ck({ committed: false })]).size).toBe(0);
  });
  it("applyLlmLayer: gated families follow the policy, missing results keep or demote, others untouched", () => {
    const t = trial();
    const rules = [ruleFact({}), ruleFact({ key: "ecog_max", param: 1 }), ruleFact({ key: "recurrent", param: undefined })];
    const res = { lines: { model: "m", facts: [raw({ param: 2 })], invalid: 0, seconds: 1 } };
    const out = applyLlmLayer(t, rules, res, new Set(["lines", "recurrent"]), { minConfidence: 0.9 }, new Set());
    expect(out.find((f) => f.key === "min_prior_lines")).toMatchObject({ value: "required", confidence: 0.99 });
    expect(out.find((f) => f.key === "ecog_max")?.value).toBe("required");
    expect(out.find((f) => f.key === "recurrent")?.value).toBe("required"); // missing result, kept
    const strict = applyLlmLayer(t, rules, {}, new Set(["lines", "recurrent"]), { minConfidence: 0.9 });
    expect(strict.find((f) => f.key === "recurrent")?.value).toBe("mentioned"); // missing result, demoted
    expect(strict.find((f) => f.key === "min_prior_lines")?.value).toBe("mentioned");
  });
});

describe("v2 LLM layer: precision guards found on the dev split", () => {
  const v = (family: Parameters<typeof verifyFamilyFacts>[0], t: LlmTrialText, f: Partial<RawLlmFact>) => verifyFamilyFacts(family, [raw(f)], t, { minConfidence: 0.9 });
  it("abstains on list items, qualified/listed histologies, exceptions and examples", () => {
    const t = trial({
      groups: ["leukemia"],
      inclusion: [
        { n: 1, text: "* TP53 mutation confirmed" },
        { n: 2, text: "Diagnosis of AML, ALL, or MPAL" },
        { n: 3, text: "Acute myeloid leukemia (AML)" },
        { n: 4, text: "Myelodysplastic syndrome (MDS)" },
        { n: 5, text: "CML in blast crisis" },
      ],
      exclusion: [{ n: 1, text: "Active infection (except hepatitis B infection)" }, { n: 2, text: "Prior daratumumab treatment" }, { n: 3, text: "History of autoimmune disease or active autoimmune disease" }],
    });
    expect(v("biomarker_v2", t, { key: "biomarker:TP53", ref: "I1", quote: "* TP53 mutation confirmed" })[0]?.reason).toBe("list_item");
    expect(v("histology", t, { key: "histology:aml", ref: "I2", quote: "Diagnosis of AML, ALL, or MPAL" })[0]?.reason).toBe("alternatives_in_criterion");
    expect(v("histology", t, { key: "histology:cml", ref: "I5", quote: "CML in blast crisis" })[0]?.reason).toBe("qualified_histology");
    const two = verifyFamilyFacts("histology", [raw({ key: "histology:aml", ref: "I3", quote: "Acute myeloid leukemia (AML)" }), raw({ key: "histology:mds", ref: "I4", quote: "Myelodysplastic syndrome (MDS)" })], t, { minConfidence: 0.9 });
    expect(two.every((c) => c.reason === "multiple_required")).toBe(true);
    expect(v("hepatitis", t, { key: "hepatitis_b", value: "excluded", ref: "E1", quote: "except hepatitis B infection", param: "active_only" })[0]?.reason).toBe("carved_out_or_example");
    expect(v("prior_drug", t, { key: "prior_drug:anti_cd38", value: "excluded", ref: "E2", quote: "Prior daratumumab treatment", time: "ever", class_level: true })[0]?.reason).toBe("single_drug");
    expect(v("autoimmune", t, { key: "autoimmune", value: "excluded", ref: "E3", quote: "History of autoimmune disease or active autoimmune disease", param: "active_only" })[0]?.reason).toBe("param_inconsistent");
  });
  it("direction and consistency checks", () => {
    const t = trial({ inclusion: [{ n: 1, text: "More than 2 prior lines of therapy" }, { n: 2, text: "Locally advanced or metastatic disease" }], exclusion: [{ n: 1, text: "At least 3 prior lines of therapy" }, { n: 2, text: "Disease refractory to prior anti-PD-1 therapy" }] });
    expect(v("lines", t, { key: "max_prior_lines", param: 2, ref: "I1", quote: "More than 2 prior lines of therapy" })[0]?.reason).toBe("direction_inconsistent");
    expect(v("lines", t, { key: "min_prior_lines", param: 3, ref: "E1", quote: "At least 3 prior lines of therapy" })[0]?.reason).toBe("direction_inconsistent");
    expect(v("stage", t, { key: "locally_advanced", ref: "I2", quote: "Locally advanced or metastatic disease" })[0]?.reason).toBe("alternatives_in_quote");
    expect(v("stage", t, { key: "locally_advanced", value: "excluded", ref: "I2", quote: "Locally advanced or metastatic disease" })[0]?.reason).toBe("bad_value");
    expect(v("prior_drug", t, { key: "prior_drug:checkpoint", value: "excluded", ref: "E2", quote: "refractory to prior anti-PD-1 therapy", time: "ever" })[0]?.reason).toBe("status_not_exposure");
    expect(v("hepatitis", trial({ exclusion: [{ n: 1, text: "Known hepatitis B infection" }] }), { key: "hepatitis_b", value: "required", ref: "E1", quote: "Known hepatitis B infection" })[0]?.reason).toBe("support_only_value");
    expect(paramInconsistent("hepatitis", "active_only", "Known hepatitis B")).toBe(true);
    expect(paramInconsistent("hepatitis", undefined, "Active hepatitis B")).toBe(true);
    expect(paramInconsistent("other_malignancy", undefined, "Other cancer within 3 years")).toBe(true);
    expect(paramInconsistent("other_malignancy", 3, "Other cancer within 3 years")).toBe(false);
    expect(paramInconsistent("lines", undefined, "x")).toBe(false);
    expect(keyCarvedOut("biomarker_v2", "biomarker:PH", "mutations such as BCR-ABL")).toBe(true);
    expect(keyCarvedOut("histology", "histology:aml", "no match here")).toBe(false);
    expect(histologyIdsIn("squamous NSCLC", ["lung"])).toEqual(["nsclc"]);
  });
  it("closed key vocabularies and an output schema per family", () => {
    const t = trial();
    for (const fam of ["lines", "prior_drug", "stage", "recurrent", "other_malignancy", "hepatitis", "biomarker_v2", "histology", "autoimmune"] as const) {
      expect(familyKeys(fam, t).length).toBeGreaterThan(0);
      expect(JSON.stringify(familySchema(fam, t))).toContain('"scope"');
    }
    expect(familyKeys("prior_drug", t)).toEqual(["prior_drug:cdk46"]);
    expect(familyKeys("prior_drug", trial({ inclusion: [], exclusion: [] })).length).toBeGreaterThan(20);
  });
});
