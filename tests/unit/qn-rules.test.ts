import { describe, expect, it } from "vitest";
import { evaluateAnswers, precheck } from "@/lib/match/precheck";
import { compileAnswer, factRelation, isNonResponse, prerequisitesHold, ruleRelation, applyPolicy, policyFor, appliesToGroup, groupOf, type CompactFact } from "@/lib/questionnaire/rules";
import type { Fact } from "@/lib/types/trial";
import type { IntakeAnswers } from "@/lib/types/intake";
import type { AnswerValue, QuestionDef } from "@/lib/types/questionnaire";
import { essentials, pick, rng, TEST_CATALOG } from "./qn-fixtures";

const Q = (id: string) => TEST_CATALOG.find((q) => q.id === id) as QuestionDef;
const fact = (key: string, value: Fact["value"], param?: string | number, extra: Partial<Fact> = {}): Fact => ({
  key: key as Fact["key"],
  value,
  quote: `${key} quote`,
  ref: { section: value === "excluded" ? "exclusion" : "inclusion", n: 1 },
  source: "rule",
  ...(param !== undefined ? { param } : {}),
  ...extra,
});
const kinds = (answers: Record<string, AnswerValue>, facts: Fact[]) => evaluateAnswers(essentials("lung", answers), TEST_CATALOG, facts).map((n) => `${n.key}:${n.kind}`);

describe("answer semantics (rules.ts)", { timeout: 60_000 }, () => {
  it("recognizes every non-response shape", () => {
    for (const v of [undefined, null, "unknown", "__skip", "prefer_not", "deferred", "not_tested", [], ["unknown"], { EGFR: "unknown", ALK: "not_tested" }]) expect(isNonResponse(v as AnswerValue)).toBe(true);
    for (const v of [0, "metastatic", ["chemotherapy"], { EGFR: "positive", ALK: "unknown" }]) expect(isNonResponse(v as AnswerValue)).toBe(false);
  });

  it("non-responses compile to nothing", () => {
    for (const q of TEST_CATALOG) {
      for (const v of ["unknown", "__skip", "prefer_not", "deferred", null, ["unknown"], { EGFR: "unknown" }] as AnswerValue[]) {
        const c = compileAnswer(q, v);
        expect(c.rules.size, `${q.id} ${JSON.stringify(v)}`).toBe(0);
        expect(c.hardFilter).toBeNull();
        expect(c.queryTerms).toEqual([]);
      }
    }
  });

  it("evaluates parameterized rules (table)", () => {
    const cases: Array<[string, AnswerValue, Fact, "conflict" | "support" | null]> = [
      ["daily_activity", "2", fact("ecog_max", "required", 1), "conflict"],
      ["daily_activity", "0-1", fact("ecog_max", "required", 1), "support"],
      ["daily_activity", "2", fact("ecog_max", "required", 2), "support"],
      ["daily_activity", "3-4", fact("ecog_max", "required", 2), "conflict"],
      ["daily_activity", "2", fact("ecog_max", "required"), "support"],
      ["brain_mets", "treated_stable", fact("brain_mets", "excluded", "active_only"), null],
      ["brain_mets", "active", fact("brain_mets", "excluded", "active_only"), "conflict"],
      ["brain_mets", "treated_stable", fact("brain_mets", "excluded"), "conflict"],
      ["brain_mets", "none", fact("brain_mets", "required"), "conflict"],
      ["brain_mets", "none", fact("brain_mets", "excluded"), null],
      ["lines", "1", fact("min_prior_lines", "required", 2), "conflict"],
      ["lines", "2", fact("min_prior_lines", "required", 2), "support"],
      ["lines", "3+", fact("max_prior_lines", "required", 1), "conflict"],
      ["lines", "1", fact("max_prior_lines", "required", 1), "support"],
      ["subtype", "nsclc_adeno", fact("histology:sclc", "required"), "conflict"],
      ["subtype", "sclc", fact("histology:sclc", "required"), "support"],
      ["subtype", "sclc", fact("histology:sclc", "excluded"), "conflict"],
      ["hiv", "controlled", fact("hiv", "excluded", "uncontrolled_only"), null],
      ["hiv", "other", fact("hiv", "excluded", "uncontrolled_only"), "conflict"],
      ["hiv", "controlled", fact("hiv", "excluded"), "conflict"],
      ["hiv", "no", fact("hiv", "excluded"), null],
      ["subtype", "sclc", fact("histology:sclc", "mentioned"), null],
      ["subtype", "sclc", fact("histology:sclc", "required", undefined, { needsReview: true }), null],
    ];
    for (const [qid, v, f, want] of cases) {
      const extra: Record<string, AnswerValue> = qid === "brain_mets" ? { spread: "metastatic" } : qid === "lines" ? { treatments: ["chemotherapy"] } : {};
      const got = kinds({ ...extra, [qid]: v }, [f]).filter((x) => x.startsWith(f.key));
      expect(got, `${qid}=${String(v)} vs ${f.key}/${f.value}/${String(f.param)}`).toEqual(want ? [`${f.key}:${want}`] : []);
    }
  });

  it("ruleRelation: paramCompare ignores string params and paramIn matches numbers by text", () => {
    const f: CompactFact = { key: "ecog_max", value: "required", param: "x" };
    expect(ruleRelation({ fact: "ecog_max", whenRequired: "support", paramCompare: { op: "lte", value: 9, else: "conflict" } }, f)).toBe("support");
    expect(ruleRelation({ fact: "ecog_max", whenRequired: "support", paramIn: ["2"] }, { key: "ecog_max", value: "required", param: 2 })).toBe("support");
    expect(ruleRelation({ fact: "ecog_max", whenRequired: "support", paramIn: ["2"] }, { key: "ecog_max", value: "required" })).toBe("neutral");
    expect(ruleRelation({ fact: "ecog_max" }, { key: "ecog_max", value: "excluded" })).toBe("neutral");
  });

  it("multi-select: unpicked options infer conflicts only for facts no picked option covers", () => {
    expect(kinds({ treatments: ["chemotherapy"] }, [fact("prior_surgery", "required")])).toEqual(["prior_surgery:conflict"]);
    expect(kinds({ treatments: ["chemotherapy"] }, [fact("prior_surgery", "excluded")])).toEqual([]);
    expect(kinds({ treatments: ["chemotherapy"] }, [fact("previously_treated", "required")])).toEqual(["previously_treated:support"]);
    expect(kinds({ treatments: ["none"] }, [fact("prior_chemotherapy", "required"), fact("newly_diagnosed", "required")])).toEqual(["prior_chemotherapy:conflict", "newly_diagnosed:support"]);
    // A partial answer that includes "unknown" adds the picked rules but no inference.
    expect(kinds({ treatments: ["chemotherapy", "unknown"] }, [fact("prior_surgery", "required"), fact("prior_chemotherapy", "required")])).toEqual(["prior_chemotherapy:support"]);
  });

  it("biomarker grid matches the v1 semantics and ignores not_tested", () => {
    expect(kinds({ biomarkers: { EGFR: "positive" } }, [fact("biomarker:EGFR", "required"), fact("biomarker:EGFR", "excluded")])).toEqual(["biomarker:EGFR:support", "biomarker:EGFR:conflict"]);
    expect(kinds({ biomarkers: { EGFR: "negative", ALK: "not_tested" } }, [fact("biomarker:EGFR", "required"), fact("biomarker:ALK", "required")])).toEqual(["biomarker:EGFR:conflict"]);
    expect(compileAnswer(Q("biomarkers"), { EGFR: "positive" }).queryTerms).toEqual(["EGFR positive."]);
    expect(compileAnswer(Q("biomarkers"), ["x"]).rules.size).toBe(0);
    expect(compileAnswer({ ...Q("biomarkers"), biomarkers: undefined } as QuestionDef, { ALK: "negative" }).rules.size).toBe(1);
  });

  it("sex answers produce a hard-filter patch only when definite", () => {
    expect(compileAnswer(Q("sex"), "female").hardFilter).toEqual({ sex: "FEMALE" });
    expect(compileAnswer(Q("sex"), "prefer_not").hardFilter).toBeNull();
    expect(compileAnswer(Q("sex"), "made_up").hardFilter).toBeNull();
    expect(compileAnswer(Q("sex"), ["female"]).hardFilter).toBeNull();
  });

  it("prerequisites: anyOf, negate, '*', and non-responses read as unknown", () => {
    const bm = Q("brain_mets");
    expect(prerequisitesHold(bm, essentials("lung", { spread: "metastatic" }))).toBe(true);
    expect(prerequisitesHold(bm, essentials("lung", { spread: "__skip" }))).toBe(true);
    expect(prerequisitesHold(bm, essentials("lung", { spread: "early" }))).toBe(false);
    expect(prerequisitesHold(bm, essentials("lung"))).toBe(false);
    const preg = Q("pregnancy");
    expect(prerequisitesHold(preg, essentials("lung"))).toBe(true);
    expect(prerequisitesHold(preg, essentials("lung", { sex: "male" }))).toBe(false);
    expect(prerequisitesHold(preg, essentials("lung", { sex: "female" }))).toBe(true);
    const lines = Q("lines");
    expect(prerequisitesHold(lines, essentials("lung", { treatments: [] }))).toBe(true);
    expect(prerequisitesHold(lines, essentials("lung", { treatments: ["none"] }))).toBe(false);
    expect(prerequisitesHold(Q("travel"), essentials("lung"))).toBe(true);
    expect(prerequisitesHold({ ...Q("travel"), prerequisites: [{ question: "biomarkers", anyOf: ["x"] }] }, essentials("lung", { biomarkers: { EGFR: "positive" } }))).toBe(false);
    expect(prerequisitesHold({ ...Q("travel"), prerequisites: [{ question: "age", anyOf: ["60"] }] }, essentials("lung"))).toBe(true);
  });

  it("group applicability and group parsing", () => {
    expect(appliesToGroup(Q("subtype"), "lung")).toBe(true);
    expect(appliesToGroup(Q("subtype"), "breast")).toBe(false);
    expect(appliesToGroup(Q("subtype"), null)).toBe(false);
    expect(appliesToGroup(Q("spread"), "myeloma")).toBe(false);
    expect(appliesToGroup(Q("spread"), null)).toBe(true);
    expect(groupOf(essentials("breast"))).toBe("breast");
    expect(groupOf({ ...essentials(), answers: { cancer_type: "nope" } })).toBeNull();
  });

  it("fact policy: penalize=false drops conflicts, keeps supports only when supportOnly", () => {
    const policy = { "histology:*": { penalize: false, weight: 1, supportOnly: true }, ecog_max: { penalize: false, weight: 1 }, prior_drug: { penalize: true, weight: 1 } };
    expect(applyPolicy("conflict", "histology:sclc", policy)).toBe("neutral");
    expect(applyPolicy("support", "histology:sclc", policy)).toBe("support");
    expect(applyPolicy("support", "ecog_max", policy)).toBe("neutral");
    expect(applyPolicy("conflict", "prior_drug:cdk46", policy)).toBe("conflict");
    expect(applyPolicy("conflict", "metastatic", policy)).toBe("conflict");
    expect(applyPolicy("conflict", "metastatic", undefined)).toBe("conflict");
    expect(policyFor(policy, "prior_drug:cdk46")).toEqual({ penalize: true, weight: 1 });
    const notes = evaluateAnswers(essentials("lung", { daily_activity: "3-4", subtype: "sclc" }), TEST_CATALOG, [fact("ecog_max", "required", 1), fact("histology:sclc", "required"), fact("histology:nsclc", "required")], policy);
    expect(notes.map((n) => `${n.key}:${n.kind}`)).toEqual(["histology:sclc:support"]);
  });

  it("factRelation: conflict wins over support across questions", () => {
    const a = compileAnswer(Q("spread"), "metastatic");
    const b = compileAnswer(Q("spread"), "early");
    expect(factRelation([a, b], { key: "metastatic", value: "required" })).toBe("conflict");
  });

  it("notes carry value/source/confidence for FACT_WEIGHT and RELIABILITY", () => {
    const [n] = evaluateAnswers(essentials("lung", { subtype: "sclc" }), TEST_CATALOG, [fact("histology:sclc", "required", undefined, { source: "llm", confidence: 0.7 })]);
    expect(n).toMatchObject({ key: "histology:sclc", kind: "support", value: "required", source: "llm", confidence: 0.7, quote: "histology:sclc quote" });
  });

  it("legacy precheck is a special case: catalog-driven notes equal v1 notes (seeded property test)", () => {
    const r = rng(42);
    const LEGACY_FACTS: Array<() => Fact> = [
      () => fact("metastatic", pick(r, ["required", "excluded", "mentioned"] as const)),
      () => fact(pick(r, ["prior_chemotherapy", "prior_radiation", "prior_surgery", "prior_immunotherapy", "prior_targeted_therapy"]), pick(r, ["required", "excluded"] as const)),
      () => fact(pick(r, ["newly_diagnosed", "previously_treated"]), "required"),
      () => fact("pregnancy", pick(r, ["required", "excluded"] as const)),
      () => fact("concurrent_trial", "excluded"),
      () => fact(`biomarker:${pick(r, ["EGFR", "ALK", "HER2", "HR"])}`, pick(r, ["required", "excluded"] as const)),
    ];
    const TREATMENT_SETS: IntakeAnswers["treatments"][] = [["none"], ["not_sure"], ["chemotherapy"], ["chemotherapy", "radiation"], ["surgery", "immunotherapy", "targeted_therapy"], ["radiation"]];
    for (let i = 0; i < 1000; i++) {
      const legacy = {
        spread: pick(r, ["yes", "no", "not_sure"] as const),
        treatments: pick(r, TREATMENT_SETS),
        biomarkers: Object.fromEntries(["EGFR", "ALK", "HER2", "HR"].filter(() => r() < 0.5).map((b) => [b, pick(r, ["positive", "negative", "dont_know"] as const)])),
        pregnant: pick(r, ["yes", "no", "not_sure", "prefer_not"] as const),
        inAnotherTrial: pick(r, ["yes", "no"] as const),
      };
      const facts = Array.from({ length: 1 + Math.floor(r() * 5) }, () => pick(r, LEGACY_FACTS)());
      const state = essentials("lung", {
        spread: { yes: "metastatic", no: "early", not_sure: "unknown" }[legacy.spread],
        treatments: legacy.treatments.includes("not_sure") ? ["unknown"] : [...legacy.treatments],
        biomarkers: Object.fromEntries(Object.entries(legacy.biomarkers).map(([b, s]) => [b, s === "dont_know" ? "unknown" : s])),
        pregnancy: legacy.pregnant === "not_sure" ? "unknown" : legacy.pregnant,
        in_other_trial: legacy.inAnotherTrial,
      });
      const v1 = precheck(legacy as Parameters<typeof precheck>[0], facts).map((n) => `${n.key}:${n.kind}`);
      const v2 = evaluateAnswers(state, TEST_CATALOG, facts).map((n) => `${n.key}:${n.kind}`);
      expect(v2, JSON.stringify({ legacy, facts: facts.map((f) => [f.key, f.value]) })).toEqual(v1);
    }
  });
});
