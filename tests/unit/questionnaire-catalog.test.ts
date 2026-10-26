import { describe, expect, it } from "vitest";
import { CANCER_GROUP_IDS } from "@/config/cancer-groups";
import { BIOMARKERS_BY_GROUP } from "@/config/biomarkers";
import { FACT_POLICY, factPolicy, findOutFor, gate, getCatalog, getFindOutItems, NON_RESPONSE_IDS, UNKNOWN, type QuestionDef } from "@/config/questionnaire";
import { validateCatalog } from "@/config/questionnaire/validate";
import { QUESTIONNAIRE_EN_ALL } from "@/config/questionnaire/en-defaults";
import { FAMILY_PRECISION } from "@/config/questionnaire/precision.generated";
import { V1_KEY_PRECISION } from "@/config/questionnaire/precision-v1.generated";
import { priors } from "@/config/questionnaire/build";
import { summarizePrecision, PRECISION_GATE, type LabelFile } from "@/lib/ingest/precision";
import { FACT_FAMILIES } from "@/lib/ingest/eligibility-facts";

const catalogs = CANCER_GROUP_IDS.map((g) => [g, getCatalog("cancer", g)] as const);

describe("question catalog", () => {
  it.each(catalogs)("%s validates (options, effects, keys, prerequisites, priors)", (_g, c) => {
    expect(validateCatalog(c)).toEqual([]);
  });
  it("starts with the four essentials in order and is cached", () => {
    for (const [g, c] of catalogs) {
      expect(c.slice(0, 4).map((q) => q.id)).toEqual(["cancer_type", "age", "zip", "travel"]);
      expect(getCatalog("cancer", g)).toBe(c);
    }
    expect(() => getCatalog("other-area" as "cancer", "lung")).toThrow();
  });
  it("non-response options carry no facts, terms or filters, in every group", () => {
    for (const [, c] of catalogs) {
      for (const q of c) for (const e of q.effects) if (NON_RESPONSE_IDS.includes(e.option)) expect(e).toEqual({ option: e.option, facts: [] });
    }
  });
  it("only coarse questions may go to AI; sensitive ones never do", () => {
    for (const [, c] of catalogs) for (const q of c) if (q.sensitive && q.id !== "pregnancy") expect(q.aiField).toBeUndefined();
  });
  it("group-specific questions follow the evidence (subtype for split groups, biomarker lists)", () => {
    const ids = (g: (typeof CANCER_GROUP_IDS)[number]) => getCatalog("cancer", g).map((q) => q.id);
    expect(ids("lung")).toContain("subtype");
    expect(ids("breast")).not.toContain("subtype");
    expect(ids("prostate")).toContain("group_status");
    expect(ids("leukemia")).not.toContain("spread");
    expect(ids("brain")).not.toContain("brain_mets");
    expect(getCatalog("cancer", "lung").find((q) => q.id === "biomarkers")?.biomarkers).toEqual(BIOMARKERS_BY_GROUP.lung);
    expect(BIOMARKERS_BY_GROUP.melanoma).not.toContain("KIT");
    expect(BIOMARKERS_BY_GROUP.prostate).not.toContain("MSI-H");
    // Prerequisites on questions absent for a group are dropped (blood cancers have no "spread").
    expect(getCatalog("cancer", "myeloma").find((q) => q.id === "measurable")?.prerequisites).toEqual([]);
  });
  it("every question has help, why and evidence text", () => {
    for (const [, c] of catalogs) for (const q of c) {
      expect(QUESTIONNAIRE_EN_ALL[q.helpKey]).toBeTruthy();
      expect(QUESTIONNAIRE_EN_ALL[q.whyKey]).toBeTruthy();
      expect(q.evidence.length).toBeGreaterThan(5);
    }
  });
  it("English defaults avoid banned claims", () => {
    for (const v of Object.values(QUESTIONNAIRE_EN_ALL)) expect(v).not.toMatch(/\b(eligible|eligibility|qualify|qualifies|you can join)\b/i);
  });
  it("find-out items exist for every findOutKey", () => {
    const items = getFindOutItems();
    for (const [, c] of catalogs) for (const q of c) if (q.findOutKey) expect(findOutFor(q)).toBeDefined();
    expect(findOutFor({ ...getCatalog("cancer", "lung")[0], findOutKey: undefined } as QuestionDef)).toBeUndefined();
    for (const it of Object.values(items)) for (const k of [it.whatKey, it.whereKey, it.whyKey]) expect(QUESTIONNAIRE_EN_ALL[k]).toBeTruthy();
  });
});

describe("precision gate", () => {
  it("questions whose primary family is below 85% ship off with a reason; passing ones stay on", () => {
    for (const [, c] of catalogs) for (const q of c) {
      if (!q.enabled) expect(q.disabledReason).toMatch(/precision gate: \w+ facts/);
      const primary = q.families[0];
      if (primary && !q.legacyFacts && q.id !== "subtype") expect(q.enabled).toBe(FAMILY_PRECISION[primary as keyof typeof FAMILY_PRECISION]?.passes === true);
    }
    const lung = getCatalog("cancer", "lung");
    expect(lung.find((q) => q.id === "daily_activity")?.enabled).toBe(FAMILY_PRECISION.performance?.passes);
    expect(lung.find((q) => q.id === "spread")?.enabled).toBe(true); // legacy metastatic facts back it
  });
  it("gate() leaves enabled-by-legacy and fact-free questions alone and reports unmeasured families", () => {
    const base = getCatalog("cancer", "lung").find((q) => q.id === "lines") as QuestionDef;
    const unmeasured = gate({ ...base, enabled: true, disabledReason: undefined, families: ["not_a_family"] } as QuestionDef);
    expect(unmeasured.enabled).toBe(false);
    expect(unmeasured.disabledReason).toContain("not measured");
    expect(gate({ ...base, enabled: true, disabledReason: undefined, families: [] } as QuestionDef).enabled).toBe(true);
    expect(gate({ ...base, enabled: true, disabledReason: undefined, legacyFacts: true } as QuestionDef).enabled).toBe(true);
  });
  it("FACT_POLICY penalizes only gated families; legacy keys below the gate keep a half-weight soft penalty", () => {
    expect(factPolicy("metastatic").belowGate === true).toBe(V1_KEY_PRECISION.metastatic?.passes !== true);
    expect(factPolicy("prior_radiation")).toEqual({ penalize: true, weight: 0.5, belowGate: true });
    expect(factPolicy("pregnancy")).toEqual({ penalize: true, weight: 1 });
    expect(factPolicy("concurrent_trial")).toEqual({ penalize: true, weight: 1 });
    expect(factPolicy("biomarker:HER2")).toEqual({ penalize: true, weight: 1.2 });
    expect(factPolicy("ecog_max").penalize).toBe(FAMILY_PRECISION.performance?.passes === true);
    expect(factPolicy("histology:sclc")).toMatchObject({ weight: 1.2 });
    expect(factPolicy("histology:sclc").penalize).toBe(FAMILY_PRECISION.histology?.passes === true);
    expect(factPolicy("other_malignancy").weight).toBe(0.5);
    expect(factPolicy("unknown_key")).toEqual({ penalize: false, weight: 1, supportOnly: true });
    expect(factPolicy("nothing:here")).toEqual({ penalize: false, weight: 1, supportOnly: true });
    for (const keys of Object.values(FACT_FAMILIES)) for (const k of keys) expect(FACT_POLICY[k]).toBeDefined();
  });
  it("priors() normalizes and puts the remainder on unknown", () => {
    expect(priors({ a: 0.5, b: 0.3 })).toEqual({ a: 0.5, b: 0.3, [UNKNOWN]: 0.2 });
    const p = priors({ a: 2, b: 2, [UNKNOWN]: 1 });
    expect(p.a).toBeCloseTo(0.4);
  });
});

describe("summarizePrecision", () => {
  const labels: LabelFile = {
    note: "",
    source: "",
    families: {
      a: {
        items: [
          ...Array.from({ length: 30 }, (_, i) => ({ id: `NCT0000000${i % 10}`, key: "ecog_max", value: "required" as const, param: 1, ref: `I${i}`, quote: "q", correct: i < 27, round: 2 })),
          { id: "NCT00000001", key: "ecog_max", value: "required" as const, param: 1, ref: "I99", quote: "q", correct: false, round: 1 },
          { id: "NCT00000001", key: "ecog_max", value: "required" as const, param: 1, ref: "I98", quote: "q", correct: null, round: 2 },
        ],
      },
      b: { items: [{ id: "NCT1", key: "hiv", value: "excluded", ref: "E1", quote: "q", correct: true }], poolSize: 1 },
      c: { items: [{ id: "NCT1", key: "hiv", value: "excluded", ref: "E2", quote: "q", correct: true }] },
      d: { items: [], measureRound: 3 },
    },
  };
  it("uses the latest labeled round, drops stale items and applies the gate", () => {
    const s = summarizePrecision(labels, (it) => (it.ref === "I0" ? { value: "required", param: 2 } : { value: it.value, ...(it.param !== undefined ? { param: it.param } : {}) }));
    const a = s.find((x) => x.family === "a");
    expect(a).toMatchObject({ labeled: 29, correct: 26, stale: 1 });
    expect(a?.precision).toBeCloseTo(26 / 29);
    expect(26 / 29 >= PRECISION_GATE && a?.passes).toBe(false); // above the gate but fewer than 30 labeled items
    expect(s.find((x) => x.family === "b")?.passes).toBe(true); // all of a 1-fact pool labeled
    expect(s.find((x) => x.family === "c")?.passes).toBe(false); // too few labels
    expect(s.find((x) => x.family === "d")).toMatchObject({ labeled: 0, precision: 0, passes: false });
    expect(summarizePrecision(labels, () => null).find((x) => x.family === "a")?.stale).toBe(30);
  });
});
