import { describe, expect, it } from "vitest";
import { parseAge, parseEligibility, unescapeMarkdown } from "@/lib/ingest/parse";
import { detectBarriers, sentences } from "@/lib/ingest/barriers";
import { extractRuleFacts, factsForCriterion } from "@/lib/ingest/facts";
import { mapGroups } from "@/lib/ingest/groups";

const ELIG = `Inclusion Criteria:

* Age ≥ 18 years
* Metastatic HER2-positive breast cancer
  * measurable disease per RECIST
* Able to read and speak English

Exclusion Criteria:

* Pregnant or breastfeeding
* Prior treatment with immune checkpoint inhibitors
* Participation in another interventional clinical trial
* Creatinine \\> 1.5 x ULN`;

describe("parseEligibility", () => {
  const { inclusion, exclusion } = parseEligibility(ELIG);
  it("numbers inclusion and exclusion criteria", () => {
    expect(inclusion.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(exclusion).toHaveLength(4);
  });
  it("keeps nested bullets with their parent and unescapes markdown", () => {
    expect(inclusion[1]?.text).toContain("measurable disease");
    expect(exclusion[3]?.text).toBe("Creatinine > 1.5 x ULN");
  });
  it("handles numbered lists and text without headers", () => {
    const r = parseEligibility("1. First item\n2. Second item");
    expect(r.inclusion.map((c) => c.text)).toEqual(["First item", "Second item"]);
    expect(parseEligibility("Healthy adults.\n\nNo other conditions.").inclusion).toHaveLength(2);
  });
  it("unescapes markdown", () => {
    expect(unescapeMarkdown("\\< 5 \\* 2")).toBe("< 5 * 2");
  });
});

describe("parseAge", () => {
  it("parses units into years", () => {
    expect(parseAge("18 Years")).toBe(18);
    expect(parseAge("6 Months")).toBe(0.5);
    expect(parseAge(undefined)).toBeNull();
    expect(parseAge("N/A")).toBeNull();
  });
});

describe("detectBarriers", () => {
  const { inclusion, exclusion } = parseEligibility(ELIG);
  it("flags English requirement with the exact sentence", () => {
    const b = detectBarriers({ inclusion, exclusion, maxAge: null });
    expect(b).toEqual([{ type: "english_required", quote: "Able to read and speak English", ref: { section: "inclusion", n: 3 } }]);
  });
  it("does not flag when another language or an interpreter is allowed", () => {
    const r = parseEligibility("Inclusion Criteria:\n* Able to read English or Spanish\n* Must speak English, or have an interpreter available");
    expect(detectBarriers({ ...r, maxAge: null })).toEqual([]);
  });
  it("flags exclusion of non-English speakers", () => {
    const r = parseEligibility("Exclusion Criteria:\n* Unable to speak and read English.");
    expect(detectBarriers({ ...r, maxAge: null })[0]?.type).toBe("english_required");
  });
  it("flags upper age limit below 75 using the structured field", () => {
    expect(detectBarriers({ inclusion: [], exclusion: [], maxAge: 70, maxAgeRaw: "70 Years" })).toEqual([{ type: "upper_age_limit", quote: "Maximum age: 70 Years" }]);
    expect(detectBarriers({ inclusion: [], exclusion: [], maxAge: 75 })).toEqual([]);
  });
  it("flags disability exclusions without a medical reason only", () => {
    const flagged = parseEligibility("Exclusion Criteria:\n* Psychiatric illness/social situations that would limit compliance with study requirements");
    expect(detectBarriers({ ...flagged, maxAge: null })[0]?.type).toBe("disability_exclusion");
    const medical = parseEligibility("Exclusion Criteria:\n* Grade 2 or higher peripheral neuropathy or hearing impairment due to prior platinum toxicity");
    expect(detectBarriers({ ...medical, maxAge: null })).toEqual([]);
  });
  it("splits sentences verbatim", () => {
    expect(sentences("First. Second; Third\nFourth")).toEqual(["First.", "Second;", "Third", "Fourth"]);
  });
});

describe("rule facts", () => {
  const { inclusion, exclusion } = parseEligibility(ELIG);
  const facts = extractRuleFacts(inclusion, exclusion);
  const get = (k: string) => facts.find((f) => f.key === k);
  it("extracts metastatic, biomarker, pregnancy, concurrent-trial, prior-therapy facts with quotes", () => {
    expect(get("metastatic")?.value).toBe("required");
    expect(get("biomarker:HER2")?.value).toBe("required");
    expect(get("pregnancy")?.value).toBe("excluded");
    expect(get("concurrent_trial")?.value).toBe("excluded");
    expect(get("prior_immunotherapy")?.value).toBe("excluded");
    expect(get("prior_immunotherapy")?.ref).toEqual({ section: "exclusion", n: 2 });
    for (const f of facts) expect([...inclusion, ...exclusion].some((c) => c.text.includes(f.quote))).toBe(true);
  });
  it("treats washouts as window-scoped exclusions, 'allowed' as mentioned, and negation as excluded", () => {
    const v = (s: "inclusion" | "exclusion", t: string, k: string) => factsForCriterion(s, t).find((f) => f.key === k)?.value;
    expect(factsForCriterion("exclusion", "Chemotherapy within 4 weeks prior to study entry").find((f) => f.key === "prior_chemotherapy")).toMatchObject({ value: "excluded", param: "within_4_weeks" });
    expect(v("inclusion", "Chemotherapy within 4 weeks prior to study entry", "prior_chemotherapy")).toBe("mentioned");
    expect(v("inclusion", "Prior radiation therapy is allowed", "prior_radiation")).toBe("mentioned");
    expect(v("inclusion", "No prior chemotherapy for metastatic disease", "prior_chemotherapy")).toBe("excluded");
    expect(v("inclusion", "Must have received prior chemotherapy", "prior_chemotherapy")).toBe("required");
    expect(v("inclusion", "HER2-negative breast cancer", "biomarker:HER2")).toBe("excluded");
    expect(v("inclusion", "Has metastatic TNBC", "biomarker:HER2")).toBe("excluded");
    expect(v("inclusion", "Locally advanced HR+/HER2- breast cancer", "biomarker:HER2")).toBe("excluded");
    expect(v("inclusion", "Locally advanced HR+/HER2- breast cancer", "biomarker:HR")).toBe("required");
    expect(v("inclusion", "HR- and HER2+ disease", "biomarker:HR")).toBe("excluded");
    expect(v("inclusion", "Documented EGFR mutation (exon 19 deletion)", "biomarker:EGFR")).toBe("required");
    expect(v("exclusion", "Known EGFR mutation or ALK rearrangement", "biomarker:ALK")).toBe("excluded");
    expect(v("inclusion", "Triple-negative breast cancer", "biomarker:HR")).toBe("excluded");
    expect(v("exclusion", "Known brain metastases", "metastatic")).toBeUndefined();
    expect(v("inclusion", "Non-metastatic disease", "metastatic")).toBe("excluded");
    expect(v("inclusion", "Newly diagnosed, previously untreated AML", "newly_diagnosed")).toBe("required");
    expect(v("inclusion", "Relapsed or refractory disease", "previously_treated")).toBe("required");
  });
});

describe("rule facts: misread criteria (H2)", () => {
  const v = (s: "inclusion" | "exclusion", t: string, k: string) => factsForCriterion(s, t).find((f) => f.key === k)?.value;
  it("treats stage III or IV and advanced-or-metastatic alternatives as mentioned", () => {
    expect(v("inclusion", "Unresectable Stage III or Stage IV HER2 negative breast cancer (either triple negative or hormone receptor positive)", "metastatic")).toBe("mentioned");
    expect(v("inclusion", "Metastatic disease or unresectable locally-advanced disease", "metastatic")).toBe("mentioned");
    expect(v("inclusion", "Lesions on PET or CT concerning for primary or metastatic malignancy", "metastatic")).toBe("mentioned");
    expect(v("inclusion", "Locally advanced/metastatic breast cancer", "metastatic")).toBe("mentioned");
    expect(v("inclusion", "Histologically confirmed metastatic NSCLC", "metastatic")).toBe("required");
    expect(v("exclusion", "History of another primary or metastatic malignancy within 3 years", "metastatic")).toBe("mentioned");
    expect(v("exclusion", "Untreated metastases to the Central Nervous System (CNS).", "metastatic")).toBeUndefined();
  });
  it("does not invert negations or read therapy lists as requirements", () => {
    expect(v("exclusion", "Spinal cord compression not definitively treated with surgery or radiation", "prior_surgery")).toBe("mentioned");
    expect(v("exclusion", "Spinal cord compression not definitively treated with surgery or radiation", "prior_radiation")).toBe("mentioned");
    expect(v("exclusion", "Malabsorption or any condition that will interfere with drug absorption (e.g., gastrectomy, prior surgery of the small bowel)", "prior_surgery")).toBe("mentioned");
    expect(v("exclusion", "Prior chemotherapy for this cancer", "prior_chemotherapy")).toBe("excluded");
    expect(v("inclusion", "No documented PSA progression following the initial PSA nadir after starting ADT.", "previously_treated")).toBe("mentioned");
    expect(v("inclusion", "Previously untreated Ph-positive ALL or relapsed CML. These participants could have received one or two courses of chemotherapy.", "previously_treated")).toBe("mentioned");
    expect(v("inclusion", "Patient must have washed out of prior chemotherapy (at least 3 weeks), radiotherapy or surgery", "prior_surgery")).toBe("mentioned");
    expect(v("inclusion", "Subjects must be PD-L1 negative and not be eligible for standard of care chemotherapy", "prior_chemotherapy")).not.toBe("required");
  });
  it("does not read TNBC in a tumor-type list as a HER2/HR exclusion", () => {
    const list = "Tumor types expected to express lower levels of FcRn including: STS, TNBC, cervical cancer, NSCLC, ovarian cancer";
    expect(v("inclusion", list, "biomarker:HER2")).toBe("mentioned");
    expect(v("inclusion", list, "biomarker:HR")).toBe("mentioned");
    expect(v("inclusion", "Participants must have one of the following cancers: TNBC, HER2+ gastric cancer", "biomarker:HER2")).toBe("mentioned");
    expect(v("inclusion", "Unresectable Stage IV breast cancer (either triple negative or hormone receptor positive)", "biomarker:HR")).toBe("mentioned");
    expect(v("inclusion", "Histologically confirmed triple-negative breast cancer", "biomarker:HER2")).toBe("excluded");
  });
});

describe("mapGroups", () => {
  it("maps MeSH to groups, falls back to text, flags baskets, and defaults to other", () => {
    expect(mapGroups(["Breast Neoplasms"], [])).toEqual(["breast"]);
    expect(mapGroups([], ["Non-small Cell Lung Cancer"])).toEqual(["lung"]);
    expect(mapGroups([], ["Advanced Solid Tumor"])).toEqual(["solid-tumors"]);
    expect(mapGroups(["Breast Neoplasms", "Lung Neoplasms", "Colorectal Neoplasms", "Prostatic Neoplasms"], [])).toContain("solid-tumors");
    expect(mapGroups([], ["Healthy"])).toEqual(["other"]);
  });
});

import { ingestAbortReason } from "@/lib/ingest/safety";
describe("ingestion safety gates", () => {
  it("aborts on >5% invalid, >40% drop, or empty output; otherwise proceeds", () => {
    expect(ingestAbortReason({ rawCount: 100, invalidCount: 6, builtCount: 94, previousCount: null })).toMatch(/failed validation/);
    expect(ingestAbortReason({ rawCount: 100, invalidCount: 5, builtCount: 95, previousCount: null })).toBeNull();
    expect(ingestAbortReason({ rawCount: 100, invalidCount: 0, builtCount: 59, previousCount: 100 })).toMatch(/dropped/);
    expect(ingestAbortReason({ rawCount: 100, invalidCount: 0, builtCount: 60, previousCount: 100 })).toBeNull();
    expect(ingestAbortReason({ rawCount: 0, invalidCount: 0, builtCount: 0, previousCount: null })).toMatch(/no valid/);
  });
});

describe("rule facts: labeled false facts (eval/facts-labels.json) stay non-directional", () => {
  const v = (s: "inclusion" | "exclusion", t: string, k: string) => factsForCriterion(s, t).find((f) => f.key === k)?.value;
  it("tissue sources, planned procedures and organization names are not treatment history", () => {
    expect(v("inclusion", "Tissue from a prior biopsy or resection must be available", "prior_surgery")).toBe("mentioned");
    expect(v("exclusion", "Participants without available tissue from prior surgery", "prior_surgery")).toBe("mentioned");
    expect(v("inclusion", "GBM recurrence or progression with planned standard of care surgical resection", "prior_surgery")).toBe("mentioned");
    expect(v("inclusion", "Confirmation of SSTR positivity by Imaging and Radiation Oncology Core after prior therapy", "prior_radiation")).toBe("mentioned");
    expect(v("inclusion", "Postmenopausal by prior bilateral oophorectomy or pelvic radiation", "prior_radiation")).toBe("mentioned");
  });
  it("a therapy offered as one option is not required", () => {
    expect(v("inclusion", "Any relapse after HSCT or CAR T cell therapy.", "prior_immunotherapy")).toBe("mentioned");
    // Plain requirements keep working.
    expect(v("inclusion", "Must have received prior chemotherapy", "prior_chemotherapy")).toBe("required");
  });
  it("negative-for-metastases wording excludes metastatic disease instead of requiring it", () => {
    expect(v("inclusion", "PSMA PET negative for metastatic disease (within 6 months of the biopsy)", "metastatic")).toBe("excluded");
  });
  it("driver lists offer options; anti-EGFR antibodies are drugs", () => {
    expect(v("inclusion", "Metastatic NSCLC with oncogenic driver mutation (EGFR, ALK, ROS1, RET)", "biomarker:ROS1")).toBe("mentioned");
    expect(v("inclusion", "Progressed after antibody therapy with bevacizumab and an anti-EGFR antibody", "biomarker:EGFR")).toBe("mentioned");
    expect(v("exclusion", "Known EGFR, ALK or ROS1 alterations", "biomarker:ROS1")).toBe("excluded");
  });
  it("recurrence alone is not prior treatment; 'relapsed or newly diagnosed' is an option", () => {
    expect(v("inclusion", "Recurrent or metastatic head and neck cancer", "previously_treated")).toBeUndefined();
    expect(v("inclusion", "Relapsed or newly diagnosed multiple myeloma", "previously_treated")).toBe("mentioned");
    expect(v("inclusion", "Relapsed or refractory disease", "previously_treated")).toBe("required");
  });
});

describe("rule facts: joined marker words", () => {
  const v = (s: "inclusion" | "exclusion", t: string, k: string) => factsForCriterion(s, t).find((f) => f.key === k)?.value;
  it("reads HR-positive / ER-positive as positive and HR-negative as negative (was inverted)", () => {
    expect(v("inclusion", "HR-positive breast cancer", "biomarker:HR")).toBe("required");
    expect(v("inclusion", "ER-positive breast cancer", "biomarker:HR")).toBe("required");
    expect(v("inclusion", "HR-negative breast cancer", "biomarker:HR")).toBe("excluded");
    expect(v("inclusion", "Locally advanced HR+/HER2- breast cancer", "biomarker:HR")).toBe("required");
    expect(v("inclusion", "HR- and HER2+ disease", "biomarker:HR")).toBe("excluded");
  });
});
