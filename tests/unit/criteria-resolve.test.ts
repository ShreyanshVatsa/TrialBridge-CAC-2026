import { describe, expect, it } from "vitest";
import { getCatalog } from "@/config/questionnaire";
import type { CancerGroupId } from "@/config/cancer-groups";
import { factsForCriterion } from "@/lib/ingest/facts";
import { hasAlternatives, normalizeMarkers, parseAgeBounds, profileFromState, resolveCriteria, resolveItem, unresolved, type ResolverProfile } from "@/lib/match/criteria-resolve";
import { evaluateAnswers, precheck } from "@/lib/match/precheck";
import { compileState, factRelation } from "@/lib/questionnaire/rules";
import type { QuestionnaireState } from "@/lib/types/questionnaire";
import { isScopedParam, type Fact, type TrialCard } from "@/lib/types/trial";

const state = (group: CancerGroupId, answers: QuestionnaireState["answers"]): QuestionnaireState => ({
  v: 2,
  area: "cancer",
  mode: "thorough",
  answers: { cancer_type: group, age: 60, zip: "10001", travel: "100", ...answers },
  history: [],
  deferred: [],
  updatedAt: 0,
});
const profile = (group: CancerGroupId, answers: QuestionnaireState["answers"] = {}): ResolverProfile => profileFromState(state(group, answers), getCatalog("cancer", group));
const lab = (section: "inclusion" | "exclusion", text: string, p: ResolverProfile, extra: { scope?: string; groups?: CancerGroupId[] } = {}) =>
  resolveItem({ id: section === "inclusion" ? "I1" : "E1", section, text, ...(extra.scope ? { scope: extra.scope } : {}) }, p, { groups: extra.groups ?? [p.group ?? "other"] }).label;
const facts = (section: "inclusion" | "exclusion", text: string) => Object.fromEntries(factsForCriterion(section, text, { v2: true }).map((f) => [f.key, f.value]));

const TREATED = { spread: "distant", disease_status: "recurrent", treatments: ["chemotherapy"], lines: "1" };
const NEW = { spread: "distant", disease_status: "new", treatments: ["none"] };

describe("known extractor gaps (eval/RESULTS.md), fixed", () => {
  it("washout windows are excluded only within the window (scoped param, never a blanket conflict)", () => {
    const cases: [string, string, string][] = [
      ["Prior chemotherapy within 4 weeks of enrollment", "prior_chemotherapy", "within_4_weeks"],
      ["Radiation therapy within 2 weeks before the first dose", "prior_radiation", "within_2_weeks"],
      ["Major surgery within 28 days of study treatment", "prior_surgery", "within_28_days"],
    ];
    for (const [text, key, param] of cases) {
      const f = factsForCriterion("exclusion", text).find((x) => x.key === key);
      expect(f, text).toMatchObject({ value: "excluded", param });
      expect(isScopedParam(f?.param)).toBe(true);
      // A patient who had that treatment (at some unknown time) is not penalized by the window.
      const fact: Fact = { key: f!.key, value: "excluded", param: f!.param!, quote: text, ref: { section: "exclusion", n: 1 }, source: "rule" };
      expect(precheck({ spread: "yes", treatments: ["chemotherapy", "radiation", "surgery"], biomarkers: {}, pregnant: "no", inAnotherTrial: "no" }, [fact])).toEqual([]);
      const compiled = compileState(state("lung", { treatments: ["chemotherapy", "radiation", "surgery"] }), getCatalog("cancer", "lung"));
      expect(factRelation(compiled, fact)).toBe("neutral");
      expect(lab("exclusion", text, profile("lung", TREATED))).toBe("unknown");
    }
  });
  it("prior chemo/radiation/surgery windows stay mentioned in inclusion text", () => {
    expect(facts("inclusion", "Prior chemotherapy within 4 weeks of enrollment").prior_chemotherapy).toBe("mentioned");
  });
  it("qualified marker wording is never a hard failure for a positive test (other than / resistance / exon / variant)", () => {
    const p = profile("lung", { biomarkers: { EGFR: "positive" } });
    for (const text of ["Subject's cancer has a known oncogenic driver alteration other than EGFR.", "Known EGFR mutations that cause resistance to osimertinib", "EGFR exon 20 insertion mutation", "Known EGFR T790M mutation"]) {
      expect(lab("exclusion", text, p), text).toBe("unknown");
    }
    expect(lab("exclusion", "Known EGFR mutation", p)).toBe("excluded");
  });
  it('"Known EGFR or ALK" excludes both markers', () => {
    expect(facts("exclusion", "Known EGFR or ALK alterations")).toMatchObject({ "biomarker:EGFR": "excluded", "biomarker:ALK": "excluded" });
    expect(lab("exclusion", "Known EGFR or ALK alterations", profile("lung", { biomarkers: { EGFR: "positive" } }))).toBe("excluded");
    expect(lab("exclusion", "Known EGFR or ALK alterations", profile("lung", { biomarkers: { ALK: "positive", EGFR: "negative" } }))).toBe("excluded");
    // Both negative: the "or" list may name more than we check, so it is left to the judge.
    expect(lab("exclusion", "Known EGFR or ALK alterations", profile("lung", { biomarkers: { ALK: "negative", EGFR: "negative" } }))).toBe("unknown");
  });
  it('"BRCA1 or BRCA2" means BRCA required', () => {
    expect(facts("inclusion", "BRCA1 or BRCA2 germline mutation")).toEqual({ "biomarker:BRCA": "required" });
    expect(lab("inclusion", "BRCA1 or BRCA2 germline mutation", profile("ovarian", { biomarkers: { BRCA: "positive" } }))).toBe("met");
    expect(lab("inclusion", "BRCA1 or BRCA2 germline mutation", profile("ovarian", { biomarkers: { BRCA: "negative" } }))).toBe("not_met");
    expect(lab("inclusion", "BRCA1 or BRCA2 germline mutation", profile("ovarian", { biomarkers: { BRCA: "unknown" } }))).toBe("unknown");
  });
  it('"Prior systemic therapy for metastatic disease" excludes previously treated patients', () => {
    expect(facts("exclusion", "Prior systemic therapy for metastatic disease")).toEqual({ previously_treated: "excluded" });
    expect(lab("exclusion", "Prior systemic therapy for metastatic disease", profile("lung", TREATED))).toBe("excluded");
    expect(lab("exclusion", "Prior systemic therapy for metastatic disease", profile("lung", NEW))).toBe("not_excluded");
  });
  it('"not received any prior therapy" excludes previously treated patients', () => {
    const t = "Patients who have not received any prior therapy for this cancer";
    expect(facts("inclusion", t)).toEqual({ previously_treated: "excluded" });
    expect(lab("inclusion", t, profile("breast", TREATED))).toBe("not_met");
    expect(lab("inclusion", t, profile("breast", NEW))).toBe("met");
  });
  it("v1 pre-check reads an excluded previously_treated fact the right way round", () => {
    const fact: Fact = { key: "previously_treated", value: "excluded", quote: "q", ref: { section: "inclusion", n: 1 }, source: "rule" };
    const base = { spread: "yes" as const, biomarkers: {}, pregnant: "no" as const, inAnotherTrial: "no" as const };
    expect(precheck({ ...base, treatments: ["chemotherapy"] }, [fact]).map((n) => n.kind)).toEqual(["conflict"]);
    expect(precheck({ ...base, treatments: ["none"] }, [fact]).map((n) => n.kind)).toEqual(["support"]);
    expect(precheck({ ...base, treatments: ["not_sure"] }, [fact])).toEqual([]);
  });
});

describe("resolver: non-responses are never not_met", () => {
  const items: ["inclusion" | "exclusion", string][] = [
    ["inclusion", "ECOG performance status 0-1"],
    ["inclusion", "Measurable disease per RECIST 1.1"],
    ["inclusion", "At least 2 prior lines of systemic therapy"],
    ["inclusion", "HER2-positive breast cancer"],
    ["exclusion", "Known active brain metastases"],
    ["exclusion", "History of other malignancy within the past 5 years"],
  ];
  it.each(["unknown", "__skip", "deferred"])("answer %s => unknown", (nr) => {
    const p = profile("breast", { spread: "distant", daily_activity: nr, measurable: nr, lines: nr, disease_status: nr, brain_mets: nr, other_cancer: nr, biomarkers: { HER2: nr === "deferred" ? "not_tested" : nr } });
    for (const [s, t] of items) expect(lab(s, t, p), t).toBe("unknown");
  });
  it("not asked => unknown", () => {
    const p = profile("breast");
    for (const [s, t] of items) expect(lab(s, t, p), t).toBe("unknown");
  });
  it("an answer whose prerequisite fails is not counted (brain_mets needs spread = distant)", () => {
    expect(lab("exclusion", "Known active brain metastases", profile("lung", { spread: "not_spread", brain_mets: "active" }))).toBe("unknown");
    expect(lab("exclusion", "Known active brain metastases", profile("lung", { spread: "distant", brain_mets: "active" }))).toBe("excluded");
  });
  it("contradictory treatment answers leave treated status unknown", () => {
    const p = profile("lung", { disease_status: "new", treatments: ["chemotherapy"] });
    expect(p.treated).toBeUndefined();
    expect(lab("inclusion", "Newly diagnosed disease", p)).toBe("unknown");
  });
});

describe("resolver: facts", () => {
  it("ECOG bands against the ceiling", () => {
    expect(lab("inclusion", "ECOG performance status 0-2", profile("lung", { daily_activity: "0-1" }))).toBe("met");
    expect(lab("inclusion", "ECOG performance status of 0 or 1", profile("lung", { daily_activity: "2" }))).toBe("not_met");
    expect(lab("inclusion", "ECOG performance status ≤ 2", profile("lung", { daily_activity: "2" }))).toBe("met");
    expect(lab("inclusion", "ECOG performance status 0-1", profile("lung", { daily_activity: "3-4" }))).toBe("not_met");
  });
  it("prior lines: a plain count is settled by the lines answer (v8), options and carve-outs are not", () => {
    expect(lab("inclusion", "At least 2 prior lines of systemic therapy", profile("lung", { ...TREATED, lines: "1" }))).toBe("not_met");
    expect(lab("inclusion", "At least 2 prior lines of systemic therapy", profile("lung", { ...TREATED, lines: "3plus" }))).toBe("met");
    expect(lab("inclusion", "At least 2 prior lines of systemic therapy", profile("lung", { ...TREATED, lines: "unknown" }))).toBe("unknown");
    expect(lab("exclusion", "Have received more than one-line of therapy for locally advanced or metastatic disease", profile("lung", { ...TREATED, lines: "2" }))).toBe("excluded");
    expect(lab("exclusion", "Have received more than one-line of therapy for locally advanced or metastatic disease", profile("lung", { ...TREATED, lines: "1" }))).toBe("not_excluded");
    expect(lab("inclusion", "At least 2 prior lines of systemic therapy, unless intolerant to standard therapy", profile("lung", { ...TREATED, lines: "1" }))).toBe("unknown");
  });
  it("extent of disease from the spread answer (v8)", () => {
    const early = profile("breast", { spread: "not_spread" });
    const distant = profile("breast", { spread: "distant" });
    const nearby = profile("breast", { spread: "nearby" });
    const removed = profile("breast", { spread: "removed" });
    expect(lab("inclusion", "Metastatic breast cancer", distant)).toBe("met");
    expect(lab("inclusion", "Metastatic breast cancer", early)).toBe("not_met");
    expect(lab("inclusion", "Locally advanced or metastatic breast cancer", nearby)).toBe("met");
    expect(lab("inclusion", "Locally advanced or metastatic breast cancer", removed)).toBe("not_met");
    expect(lab("inclusion", "Pathologically proven diagnosis of invasive breast cancer, clinical stage I or II", distant)).toBe("not_met");
    expect(lab("inclusion", "No metastatic disease (M0) per most recent PET/CT", distant)).toBe("not_met");
    expect(lab("inclusion", "Patients must not have recurrent or metastatic (stage IV) breast cancer", distant)).toBe("not_met");
    expect(lab("exclusion", "Stage IV, metastatic breast cancer", distant)).toBe("excluded");
    expect(lab("exclusion", "Stage IV, metastatic breast cancer", early)).toBe("not_excluded");
    // Site-specific metastases, treatment settings, subgroup rules and pain from metastases are not the patient's stage.
    expect(lab("exclusion", "Known brain metastases", distant)).toBe("unknown");
    expect(lab("exclusion", "Hepatic-only metastatic disease", distant)).toBe("unknown");
    expect(lab("exclusion", "Pain due to metastatic prostate cancer requiring opioid treatment", profile("prostate", { spread: "distant" }))).toBe("unknown");
    expect(lab("inclusion", "Patients with metastatic disease must have measurable lesions", early)).toBe("unknown");
    expect(lab("inclusion", "Stage I-IV breast cancer", early)).toBe("unknown");
    expect(lab("inclusion", "Metastatic breast cancer", profile("breast"))).toBe("unknown");
  });
  it("treated status from the item's own wording (v8)", () => {
    const treated = profile("breast", { ...TREATED, lines: "2" });
    const untreated = profile("breast", NEW);
    expect(lab("inclusion", "Previously untreated with any systemic anti-cancer therapy for their locoregionally recurrent or metastatic disease", treated)).toBe("not_met");
    expect(lab("inclusion", "Previously untreated with any systemic anti-cancer therapy for their locoregionally recurrent or metastatic disease", untreated)).toBe("met");
    expect(lab("inclusion", "Newly diagnosed, previously untreated disease", treated)).toBe("not_met");
    expect(lab("inclusion", "Relapsed or refractory disease after at least one prior line of therapy", untreated)).toBe("not_met");
    expect(lab("exclusion", "Any prior systemic therapy for locally advanced unresectable or metastatic breast cancer", treated)).toBe("excluded");
    expect(lab("exclusion", "Any prior systemic therapy for locally advanced unresectable or metastatic breast cancer", untreated)).toBe("not_excluded");
    // Class-, drug-, toxicity- and count-specific history items are not settled by the treated flag.
    expect(lab("inclusion", "No prior therapy with CDK4/6 inhibition", treated)).toBe("unknown");
    expect(lab("inclusion", "Participants must not have received prior treatment with anti-VEGF therapies", treated)).toBe("unknown");
    expect(lab("exclusion", "Prior treatment with an Aurora Kinase A specific-targeted agent, including alisertib", treated)).toBe("unknown");
    expect(lab("exclusion", "Unresolved toxicities from prior therapies", treated)).toBe("unknown");
    expect(lab("exclusion", "Treatment with chemotherapy in the recurrent or metastatic setting", treated)).toBe("unknown");
    expect(lab("exclusion", "Prior systemic therapy within 4 weeks of enrollment", treated)).toBe("unknown");
    expect(lab("inclusion", "No prior systemic treatment for metastatic disease. Participants who received adjuvant therapy may enroll if there was no recurrence within 12 months", treated)).toBe("unknown");
  });
  it("negated marker lists, option-by-option alternatives, subtype items and plain hepatitis exclusions (v8)", () => {
    const egfr = profile("lung", { biomarkers: { EGFR: "positive", ALK: "negative", ROS1: "negative" } });
    expect(lab("inclusion", "Metastatic Stage IV NSCLC without EGFR, ALK, or ROS1 genomic alterations", { ...egfr, spread: "distant" })).toBe("not_met");
    expect(lab("inclusion", "Adenocarcinoma of the lung that does not have an EGFR sensitizing mutation or ALK or ROS1 translocation", egfr)).toBe("not_met");
    expect(lab("inclusion", "Has no known tumour genomic alterations in NTRK, BRAF V600, RET, MET exon 14 skipping, KRAS G12C, or HER2", profile("lung", { biomarkers: { KRAS: "positive" } }))).toBe("unknown");
    const hrPos = profile("breast", { biomarkers: { HER2: "negative", HR: "positive" } });
    expect(lab("inclusion", "Have HER2-positive or triple-negative breast cancer", hrPos)).toBe("not_met");
    expect(lab("inclusion", "Metastatic breast cancer that is triple negative or ER-positive", { ...hrPos, spread: "distant" })).toBe("unknown");
    expect(lab("inclusion", "EGFR mutation or ALK rearrangement", profile("lung", { biomarkers: { EGFR: "negative", ALK: "negative" } }))).toBe("not_met");
    expect(lab("inclusion", "EGFR mutation or ALK rearrangement", profile("lung", { biomarkers: { EGFR: "negative" } }))).toBe("unknown");
    const sclc = profile("lung", { subtype: "sclc" });
    expect(lab("inclusion", "Histologically or cytologically confirmed non-squamous NSCLC", sclc)).toBe("not_met");
    expect(lab("inclusion", "Patients with NSCLC must have measurable disease", sclc)).toBe("unknown");
    const hepC = profile("lymphoma", { hepatitis: "hep_c" });
    expect(lab("exclusion", "Known hepatitis B or C virus infection", hepC)).toBe("excluded");
    expect(lab("exclusion", "Known hepatitis B or C virus infection", profile("lymphoma", { hepatitis: "no" }))).toBe("not_excluded");
    expect(lab("exclusion", "Positive test for hepatitis C ribonucleic acid (HCV RNA)", hepC)).toBe("unknown");
    expect(lab("exclusion", "Active hepatitis B infection (HBsAg positive) without receiving antiviral treatment", profile("lymphoma", { hepatitis: "hep_b" }))).toBe("unknown");
    expect(lab("inclusion", "Known BRAF mutational status", profile("melanoma", { biomarkers: { BRAF: "negative" } }))).toBe("unknown");
    expect(lab("exclusion", "Patients in Phase 2b with IDH-wildtype glioblastoma who have had more than one recurrence", profile("brain", { biomarkers: { IDH: "negative" } }))).toBe("unknown");
    expect(lab("inclusion", "For IDH-mutated glioma, prior treatment with both radiation and alkylating chemotherapy", profile("brain", { biomarkers: { IDH: "negative" } }))).toBe("unknown");
    expect(lab("inclusion", "Age:\n- Synovial Sarcoma: 2 to 17 years\n- Osteosarcoma: 2 to 21 years", profile("sarcoma"))).toBe("unknown");
  });
  it("registration headers, assessment windows and definitions do not hide a plain rule (v8)", () => {
    expect(lab("inclusion", "STEP 1: REGISTRATION (SCREENING): Participants must have Zubrod Performance Status of 0-2", profile("lung", { daily_activity: "3-4" }))).toBe("not_met");
    expect(lab("inclusion", "Have an ECOG performance status of 0 to 1. Evaluation of ECOG is to be performed within 30 days prior to the date of randomization", profile("lung", { daily_activity: "2" }))).toBe("not_met");
    expect(hasAlternatives("HR positive, HER2 negative breast cancer (estrogen receptor [ER] and/or progesterone receptor [PR] >1%)")).toBe(false);
    expect(hasAlternatives("Metastatic or locally advanced unresectable breast cancer")).toBe(false);
    expect(hasAlternatives("Relapsed or refractory multiple myeloma")).toBe(false);
  });
  it("receptor pairs with their results and HER2 score ranges are one attribute, real options stay (v9)", () => {
    expect(hasAlternatives("Hormone receptor positive (estrogen receptor positive [ER+] and/or progesterone receptor positive [PR+]), HER-2 negative breast cancer")).toBe(false);
    expect(hasAlternatives("HR-positive (either ER or PgR >= 1%) breast cancer")).toBe(false);
    expect(hasAlternatives("HER2-negative (IHC score of 0, 1+, or 2+ with ISH not amplified)")).toBe(false);
    expect(hasAlternatives("Triple negative or hormone resistant HER2-negative breast cancer")).toBe(true);
    expect(hasAlternatives("EGFR mutation or ALK rearrangement")).toBe(true);
  });
  it("brain metastases with and without the active-only carve-out", () => {
    const t = "Active, untreated brain metastases";
    expect(lab("exclusion", t, profile("lung", { spread: "distant", brain_mets: "none" }))).toBe("not_excluded");
    expect(lab("exclusion", t, profile("lung", { spread: "distant", brain_mets: "treated_stable" }))).toBe("not_excluded");
    expect(lab("exclusion", t, profile("lung", { spread: "distant", brain_mets: "active" }))).toBe("excluded");
  });
  it("measurable disease", () => {
    expect(lab("inclusion", "Measurable disease per RECIST 1.1", profile("lung", { spread: "distant", measurable: "yes" }))).toBe("met");
    expect(lab("inclusion", "Measurable disease per RECIST 1.1", profile("lung", { spread: "distant", measurable: "no" }))).toBe("not_met");
  });
  it("other malignancy windows", () => {
    const t = "History of other malignancy within the past 5 years";
    expect(lab("exclusion", t, profile("lung", { other_cancer: "no" }))).toBe("not_excluded");
    expect(lab("exclusion", t, profile("lung", { other_cancer: "recent" }))).toBe("excluded");
    expect(lab("exclusion", t, profile("lung", { other_cancer: "over_2y" }))).toBe("unknown");
    // "prior treatment with a cancer vaccine" is not another cancer.
    expect(lab("exclusion", "Has received prior treatment with a cancer vaccine", profile("lung", { other_cancer: "no" }))).toBe("unknown");
  });
  it("biomarkers, including HGNC aliases", () => {
    expect(normalizeMarkers("CD274-positive tumor")).toBe("PD-L1-positive tumor");
    expect(lab("inclusion", "CD274-positive tumor", profile("lung", { biomarkers: { "PD-L1": "positive" } }))).toBe("met");
    expect(lab("inclusion", "HER2-positive breast cancer", profile("breast", { biomarkers: { HER2: "negative" } }))).toBe("not_met");
    expect(lab("exclusion", "Patients with MSI-high (dMMR) tumors", profile("colorectal", { biomarkers: { "MSI-H": "negative" } }))).toBe("not_excluded");
  });
  it("age, both sections, and age mentioned in passing", () => {
    expect(lab("inclusion", "Age ≥ 18 years", profile("lung"))).toBe("met");
    expect(lab("inclusion", "Age ≥ 18 years", profileFromState(state("lung", { age: 16 }), getCatalog("cancer", "lung")))).toBe("not_met");
    expect(lab("exclusion", "Age < 18 years", profile("lung"))).toBe("not_excluded");
    expect(lab("exclusion", "Age < 18 years", profileFromState(state("lung", { age: 16 }), getCatalog("cancer", "lung")))).toBe("excluded");
    expect(lab("inclusion", "Total bilirubin =< 1.5 times the institutional upper limit of normal for age", profile("lung"))).toBe("unknown");
    expect(lab("inclusion", "Patients < 18 years old must have a body weight ≥ 40 kg.", profile("lung"))).toBe("unknown");
    expect(parseAgeBounds("Between 18 and 75 years of age")).toEqual({ min: 18, max: 75 });
    expect(parseAgeBounds("18 years of age or older")).toEqual({ min: 18 });
  });
  it("age wordings: operators, spelled-out numbers, consent time, sex-named, and two-sided exclusions", () => {
    const young = profileFromState(state("lung", { age: 16 }), getCatalog("cancer", "lung"));
    for (const t of ["Age >/= 18 years.", "Age ≥18 years at the time of consent.", "Must be > = 50 years of age.", "Age greater than or equal to 18 years and less than or equal to 72 years.", "Adults (male and female) age >18", "18 years and older", "B. Both males and females ≥ eighteen years of age", "Age 30 years to 74 years old"]) {
      expect(lab("inclusion", t, profile("lung")), t).toBe("met");
    }
    expect(lab("inclusion", "Age >/= 18 years.", young)).toBe("not_met");
    expect(lab("inclusion", "Men and women >= 18 years of age", young)).toBe("not_met");
    expect(lab("inclusion", "Females, aged 18 years and older", profile("lung", { sex: "female" }))).toBe("met");
    expect(lab("inclusion", "Females, aged 18 years and older", profile("lung", { sex: "male" }))).toBe("not_met");
    // Compound consent wording, two-sided exclusions and bulleted per-group lists stay with the judge.
    expect(lab("inclusion", "Age 18 or over and able to give informed consent", profile("lung"))).toBe("unknown");
    expect(lab("exclusion", "Under age 45 or over age 74", profile("lung"))).toBe("unknown");
    expect(lab("exclusion", "Participant is 18 years or older, currently cared for by pediatrics service", profile("lung"))).toBe("unknown");
    expect(parseAgeBounds("Age 18 or over")).toEqual({ min: 18 });
  });
  it("exclusions the patient plainly lacks are settled despite windows, carve-outs and same-fact lists", () => {
    const asked = (answers: QuestionnaireState["answers"]) => {
      const st = state("breast", answers);
      return profileFromState({ ...st, history: Object.keys(st.answers) }, getCatalog("cancer", "breast"));
    };
    const no = asked({ age: 50, sex: "female", pregnancy: "no", hiv: "no", hepatitis: "no", autoimmune: "no", transplant: "none", in_other_trial: "no", other_cancer: "no", brain_mets: "none", spread: "distant", organ_problems: ["none"] });
    for (const t of [
      "Participants who are pregnant or nursing because of the potentially dangerous effects of the treatment on the fetus or infant.",
      "Active autoimmune disease that has required systemic treatment in past 2 years",
      "Patients who are receiving any other investigational agents.",
      "Known active hepatitis B or known active hepatitis C infection.",
      "Known active central nervous system metastases and/or carcinomatous meningitis. Patients with previously treated brain metastases are eligible.",
      "Prior allogeneic bone marrow transplantation or solid organ transplantation.",
    ]) expect(lab("exclusion", t, no), t).toBe("not_excluded");
    // Not settled: the item names something the answers do not cover, or is not about the answered condition.
    for (const t of ["nursing home resident", "Active infection with Hepatitis B, Hepatitis C, or active systemic viral disease or active severe infection.", "HIV positive or on chronic steroids", "Spinal cord compression or active brain metastases", "Significant cardiac disease"]) {
      expect(lab("exclusion", t, no), t).toBe("unknown");
    }
    // A reported condition is never settled as "not excluded".
    expect(lab("exclusion", "Active autoimmune disease that has required systemic treatment in past 2 years", asked({ sex: "female", autoimmune: "yes_active" }))).not.toBe("not_excluded");
    // Unanswered stays unknown.
    expect(lab("exclusion", "Patients who are receiving any other investigational agents.", asked({ sex: "female" }))).toBe("unknown");
  });
  it("measurable disease wording settles only when nothing else is asked", () => {
    const m = profile("breast", { sex: "female", spread: "distant", measurable: "yes" });
    expect(lab("inclusion", "Measurable disease per Response Evaluation Criteria in Solid Tumors (RECIST) v1.1.", m)).toBe("met");
    expect(lab("inclusion", "Measurable disease based on RECIST 1.1.", m)).toBe("met");
    expect(lab("inclusion", "At least one measurable lesion per RECIST v1.1 in the liver.", m)).toBe("unknown");
  });
  it("sex", () => {
    expect(lab("inclusion", "Female", profile("breast", { sex: "female" }))).toBe("met");
    expect(lab("inclusion", "Female", profile("breast", { sex: "male" }))).toBe("not_met");
    expect(lab("inclusion", "Female", profile("breast", { sex: "prefer_not" }))).toBe("unknown");
  });
  it("cancer type and subtype", () => {
    expect(lab("inclusion", "Histologically or cytologically confirmed melanoma", profile("melanoma"))).toBe("met");
    // A named subtype the patient did not report is not settled by the group alone.
    expect(lab("inclusion", "Patients diagnosed with acute promyelocytic leukemia", profile("leukemia"))).toBe("unknown");
    expect(lab("exclusion", "Small cell lung cancer histology.", profile("lung", { subtype: "nsclc_adeno" }))).toBe("not_excluded");
  });
});

describe("resolver: items left to the judge", () => {
  const p = profile("lung", { ...TREATED, daily_activity: "3-4", brain_mets: "active", biomarkers: { EGFR: "negative", ALK: "negative" } });
  it("scoped items", () => {
    expect(lab("inclusion", "ECOG performance status 0-1", p, { scope: "Cohort A" })).toBe("unknown");
    expect(lab("inclusion", "Part B: ECOG performance status 0-1", p)).toBe("unknown");
  });
  it("inclusion alternatives", () => {
    expect(hasAlternatives("EGFR mutation or ALK rearrangement")).toBe(true);
    expect(hasAlternatives("ECOG performance status of 0 or 1")).toBe(false);
    expect(hasAlternatives("Histologically or cytologically confirmed NSCLC")).toBe(false);
    // every option is checked; both markers negative => not met, one unknown => unknown.
    expect(lab("inclusion", "EGFR mutation or ALK rearrangement", p)).toBe("not_met");
    expect(lab("inclusion", "EGFR mutation or ALK rearrangement", profile("lung", { biomarkers: { EGFR: "negative" } }))).toBe("unknown");
  });
  it("time windows the answers can't settle", () => {
    expect(lab("exclusion", "Brain metastases treated within 4 weeks of enrollment", p)).toBe("unknown");
  });
  it("permissive wording and carve-outs", () => {
    expect(lab("inclusion", "Patients with untreated brain metastases are allowed provided they are asymptomatic", p)).toBe("unknown");
    expect(lab("exclusion", "Prior systemic therapy for metastatic disease, unless given more than 12 months ago", p)).toBe("unknown");
  });
  it("items outside the listed facts", () => {
    expect(lab("inclusion", "Absolute neutrophil count ≥ 1.5 × 10^9/L", p)).toBe("unknown");
    expect(lab("exclusion", "Pregnant or breastfeeding", p)).toBe("unknown");
  });
  it("positive labels need the item to be about the checked facts", () => {
    const ok = profile("lung", { daily_activity: "0-1" });
    expect(lab("inclusion", "ECOG performance status 0-1 and adequate bone marrow, liver and kidney function", ok)).toBe("unknown");
    expect(lab("inclusion", "ECOG 0-1 and prior treatment with osimertinib", ok)).toBe("unknown");
  });
});

describe("resolveCriteria", () => {
  const card: Pick<TrialCard, "id" | "groups" | "conditions" | "criteria" | "criteriaVersion"> = {
    id: "NCT00000001",
    groups: ["lung"],
    conditions: ["Non-small Cell Lung Cancer"],
    criteriaVersion: 1,
    criteria: [
      { id: "I1", section: "inclusion", text: "Age ≥ 18 years" },
      { id: "I2", section: "inclusion", text: "ECOG performance status 0-1" },
      { id: "I3", section: "inclusion", text: "Adequate organ function" },
      { id: "E1", section: "exclusion", text: "Known active brain metastases" },
    ],
  };
  it("labels every item in order, resolver-only, with question ids and optional answer ids", () => {
    const p = profile("lung", { spread: "distant", daily_activity: "2", brain_mets: "none" });
    const r = resolveCriteria(card, p, { answerIds: { age: "A2", daily_activity: "A5", brain_mets: "A7" } });
    expect(r).toMatchObject({ trialId: "NCT00000001", criteriaVersion: 1, provider: null });
    expect(r.labels.map((l) => [l.id, l.label])).toEqual([["I1", "met"], ["I2", "not_met"], ["I3", "unknown"], ["E1", "not_excluded"]]);
    expect(r.labels[1]).toMatchObject({ source: "rule", questions: ["daily_activity"], answerIds: ["A5"] });
    expect(r.labels[2]).toMatchObject({ source: "default" });
    expect(unresolved(r.labels)).toEqual(["I3"]);
    for (const l of r.labels) expect((l.reason ?? "").split(/\s+/).length).toBeLessThanOrEqual(25);
  });
  it("cards without split criteria give no labels", () => {
    expect(resolveCriteria({ ...card, criteria: undefined, criteriaVersion: undefined }, profile("lung")).labels).toEqual([]);
  });
});

describe("MSI status wording (an MSS trial once ranked #1 for an MSI-high answer, NCT07284849)", () => {
  const msiH = () => profile("colorectal", { biomarkers: { "MSI-H": "positive" } });
  const mss = () => profile("colorectal", { biomarkers: { "MSI-H": "negative" } });
  it("excludes an MSI-high patient on a bare 'MSI-H/dMMR' exclusion and keeps an MSS patient", () => {
    expect(lab("exclusion", "MSI-H/dMMR per historical data in the medical record.", msiH())).toBe("excluded");
    expect(lab("exclusion", "MSI-H/dMMR per historical data in the medical record.", mss())).not.toBe("excluded");
  });
  it("reads MSS / microsatellite stable / pMMR as the negative state of MSI-H", () => {
    expect(lab("inclusion", "Histologically confirmed microsatellite stable (MSS) metastatic colorectal adenocarcinoma", msiH())).toBe("not_met");
    expect(lab("inclusion", "pMMR/MSS tumor", msiH())).toBe("not_met");
    expect(lab("inclusion", "Tumor must be mismatch repair proficient (not MSI-H)", msiH())).toBe("not_met");
    expect(lab("exclusion", "Known microsatellite stable disease", msiH())).not.toBe("excluded");
    expect(lab("exclusion", "Known microsatellite stable disease", mss())).toBe("excluded");
  });
  it("leaves mixed, optional or unanswered MSI wording unknown", () => {
    expect(lab("inclusion", "MSI-H or MSS colorectal cancer", msiH())).toBe("unknown");
    expect(lab("inclusion", "Any MSI status, regardless of MSI-H or MSS", msiH())).toBe("unknown");
    expect(lab("inclusion", "pMMR/MSS tumor", profile("colorectal"))).toBe("unknown");
  });
});

describe("pre-check ignores qualified biomarker wording (NCT07315113 'What might rule you out')", () => {
  const fact = (quote: string, value: "excluded" | "required" = "excluded"): Fact => ({ key: "biomarker:EGFR", value, quote, ref: { section: "exclusion", n: 1 }, source: "rule" });
  const v1 = { spread: "yes" as const, treatments: ["chemotherapy"], biomarkers: { EGFR: "positive" as const }, pregnant: "no" as const, inAnotherTrial: "no" as const };
  const egfrPos = state("lung", { biomarkers: { EGFR: "positive" } });
  const catalog = getCatalog("cancer", "lung");
  it("no conflict for 'other than EGFR' or resistance-mutation wording", () => {
    for (const q of ["Known oncogenic driver alteration other than EGFR", "Known EGFR mutations that cause resistance to osimertinib", "EGFR T790M mutation"]) {
      expect(precheck(v1, [fact(q)])).toEqual([]);
      expect(evaluateAnswers(egfrPos, catalog, [fact(q)])).toEqual([]);
    }
  });
  it("still conflicts on plain wording", () => {
    expect(precheck(v1, [fact("Known EGFR mutation")]).map((n) => n.kind)).toEqual(["conflict"]);
    expect(evaluateAnswers(egfrPos, catalog, [fact("Known EGFR mutation")]).map((n) => n.kind)).toEqual(["conflict"]);
  });
});

describe("single-marker requirement with specimen / extent / method 'or' (QA: ALK-negative patient, ALK-positive trial stayed unknown)", () => {
  const alkNeg = () => profile("lung", { biomarkers: { EGFR: "positive", ALK: "negative" } });
  it("is not_met for an ALK-negative answer", () => {
    expect(lab("inclusion", "Documented Anaplastic Lymphoma Kinase (ALK) rearrangement via testing of tissue or blood", alkNeg())).toBe("not_met");
    expect(lab("inclusion", "Documented ALK rearrangement as detected by: (1) fluorescence in situ hybridization (FISH), (2) immuno-histochemistry (IHC), (3) tissue next-generation sequencing (NGS), or (4) circulating tumor DNA (ctDNA) NGS", alkNeg())).toBe("not_met");
    expect(lab("inclusion", "Locally advanced or metastatic NSCLC with a documented ALK rearrangement", alkNeg())).toBe("not_met");
  });
  it("is not_met for a HER2-negative requirement with extent / therapy 'or' wording and a HER2-positive answer", () => {
    const her2 = profile("breast", { biomarkers: { HER2: "positive" } });
    expect(lab("inclusion", "Confirmed HER2-negative breast cancer with locally advanced or metastatic disease, not amenable to surgical resection or radiation therapy with curative intent.", her2)).toBe("not_met");
  });
  it("stays unknown when markers are real alternatives or the answer is missing", () => {
    expect(lab("inclusion", "Documented ALK rearrangement or EGFR mutation", profile("lung", { biomarkers: { ALK: "negative" } }))).toBe("unknown");
    expect(lab("inclusion", "Documented ALK rearrangement via tissue or blood", profile("lung"))).toBe("unknown");
    expect(lab("inclusion", "Documented ALK rearrangement via tissue or blood", profile("lung", { biomarkers: { ALK: "unknown" } }))).toBe("unknown");
    expect(hasAlternatives("ALK fusion by FISH or EGFR mutation")).toBe(true);
  });
});

describe("health-history answers (exclusion items only)", () => {
  const healthy = () => profile("lung", { age: 45, sex: "female", hiv: "no", hepatitis: "no", transplant: "none", autoimmune: "no", organ_problems: ["none"], pregnancy: "no", in_other_trial: "no" });
  const sick = () => profile("lung", { age: 45, sex: "female", hiv: "other", hepatitis: "hep_b", transplant: "organ", autoimmune: "yes_active", organ_problems: ["kidney", "heart"], pregnancy: "yes", in_other_trial: "yes" });
  it("settles plain exclusions both ways", () => {
    const cases: [string, string, string][] = [
      ["Known human immunodeficiency virus (HIV) infection", "not_excluded", "excluded"],
      ["Prior solid organ transplant", "not_excluded", "excluded"],
      ["History of autoimmune disease", "not_excluded", "excluded"],
      ["Pregnant or breastfeeding women", "not_excluded", "excluded"],
      ["Concurrent participation in another interventional clinical trial", "not_excluded", "excluded"],
      ["Patients on dialysis", "not_excluded", "excluded"],
      ["History of congestive heart failure.", "not_excluded", "excluded"],
    ];
    for (const [text, h, s] of cases) {
      expect(lab("exclusion", text, healthy())).toBe(h);
      expect(lab("exclusion", text, sick())).toBe(s);
    }
  });
  it("uses the catalog carve-outs: controlled HIV, active-only autoimmune and hepatitis", () => {
    const controlled = profile("lung", { hiv: "controlled" });
    expect(lab("exclusion", "Known HIV infection with detectable viral load", controlled)).toBe("not_excluded");
    expect(lab("exclusion", "Known HIV infection with detectable viral load", profile("lung", { hiv: "other" }))).toBe("excluded");
    expect(lab("exclusion", "Active autoimmune disease", profile("lung", { autoimmune: "yes_inactive" }))).toBe("not_excluded");
    expect(lab("exclusion", "Active autoimmune disease", profile("lung", { autoimmune: "yes_active" }))).toBe("excluded");
    // The answer does not say whether hepatitis B is active; and the hepatitis family is below the precision gate.
    expect(lab("exclusion", "Active hepatitis B or C infection", profile("lung", { hepatitis: "hep_b" }))).toBe("unknown");
    expect(lab("exclusion", "Active hepatitis B or C infection", profile("lung", { hepatitis: "no" }))).toBe("not_excluded");
  });
  it("a different transplant or organ answer does not exclude", () => {
    expect(lab("exclusion", "Prior allogeneic stem cell transplantation", profile("lung", { transplant: "organ" }))).toBe("not_excluded");
    expect(lab("exclusion", "Known liver cirrhosis", profile("lung", { organ_problems: ["kidney", "heart"] }))).toBe("not_excluded");
  });
  it("never fails or meets inclusion items about health history (they are conditional)", () => {
    for (const text of ["HIV-infected participants must have well-controlled HIV on ART", "DONOR: The donor must be HIV negative", "Patients with relapsed disease after prior allogeneic SCT must have no active GVHD"]) {
      expect(lab("inclusion", text, healthy())).toBe("unknown");
      expect(lab("inclusion", text, sick())).toBe("unknown");
    }
    expect(lab("inclusion", "Women of childbearing potential must have a negative pregnancy test", healthy())).toBe("unknown");
  });
  it("lab and broad cardiac rules stay unknown with a 'none of these' organ answer", () => {
    expect(lab("inclusion", "Adequate liver function", healthy())).toBe("unknown");
    expect(lab("exclusion", "Have active cardiac disease, defined as:", healthy())).toBe("unknown");
    expect(lab("exclusion", "Clinically significant cardiovascular disease", healthy())).toBe("unknown");
  });
  it("does not read brain-metastasis wording as distant spread", () => {
    expect(lab("exclusion", "Presence of central nervous system (CNS) metastases.", profile("lung", { spread: "distant" }))).toBe("unknown");
  });
  it("men are read as not pregnant; the pregnancy question is not asked over 59", () => {
    expect(lab("exclusion", "Pregnant or breastfeeding women", profile("lung", { age: 45, sex: "male" }))).toBe("not_excluded");
    expect(lab("exclusion", "Pregnant or breastfeeding women", profile("lung", { age: 65, sex: "female", pregnancy: "no" }))).toBe("unknown");
  });
});

describe("rules addressed to a subgroup", () => {
  it("do not fail the patient on the subgroup's own fact", () => {
    const hrNeg = profile("breast", { biomarkers: { HER2: "positive", HR: "negative" } });
    expect(lab("inclusion", "Documented HER2 and hormonal receptor status per protocol, ER/PR+ patients must be refractory to at least one prior hormonal treatment.", hrNeg)).toBe("unknown");
    expect(lab("inclusion", "Patients with treated brain metastases must be stable for at least 4 weeks", profile("lung", { brain_mets: "none" }))).toBe("unknown");
  });
  it("plain requirements still fail", () => {
    expect(lab("inclusion", "HR-positive breast cancer", profile("breast", { biomarkers: { HR: "negative" } }))).toBe("not_met");
  });
});
