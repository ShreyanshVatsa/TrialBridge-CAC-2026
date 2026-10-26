import { describe, expect, it } from "vitest";
import { cohortSpecific, familyOf, kpsToEcog, moreLenient, parseEcog, parseKpsMin, parseLines, v2FactsForSegment } from "@/lib/ingest/eligibility-facts";
import { extractRuleFacts, factsForCriterion } from "@/lib/ingest/facts";
import type { CancerGroupId } from "@/config/cancer-groups";
import type { CriterionSection } from "@/lib/types/trial";

/** key -> "value" or "value(param)" for one clause. */
function facts(section: CriterionSection, text: string, groups: CancerGroupId[] = []): Record<string, string> {
  return Object.fromEntries(v2FactsForSegment(section, text, { groups }).map((f) => [f.key, f.param !== undefined ? `${f.value}(${f.param})` : f.value]));
}
const inc = (t: string, g: CancerGroupId[] = []) => facts("inclusion", t, g);
const exc = (t: string, g: CancerGroupId[] = []) => facts("exclusion", t, g);

describe("performance status -> ecog_max", () => {
  it.each([
    ["ECOG performance status of 0 or 1", "required(1)"],
    ["Eastern Cooperative Oncology Group (ECOG) performance status 0-2.", "required(2)"],
    ["ECOG PS ≤ 2", "required(2)"],
    ["ECOG performance status <2", "required(1)"],
    ["ECOG performance status of 0, 1, or 2", "required(2)"],
    ["ECOG 2 or less", "required(2)"],
    ["ECOG performance status of 0", "required(0)"],
    ["Karnofsky performance status (KPS) ≥ 70", "required(1)"],
    ["Karnofsky or Lansky score of > 60%", "required(1)"],
    ["Performance status KPS 60-100/ECOG 0-2", "required(2)"],
    ["Patients must have an ECOG status of ≤1 or Karnofsky Performance Status (KPS) ≥60.", "required(2)"],
    ["Karnofsky performance score of at least 50%", "required(2)"],
    ["KPS 70 or higher", "required(1)"],
    ["Performance status 0-1", "required(1)"],
  ])("inclusion %s", (text, want) => expect(inc(text).ecog_max).toBe(want));
  it.each([
    ["ECOG performance status 2 or higher", "required(1)"],
    ["ECOG > 2", "required(2)"],
    ["ECOG ≥ 3", "required(2)"],
    ["ECOG performance status of 3-4", "required(2)"],
    ["Karnofsky performance status < 70", "required(1)"],
    ["Karnofsky ≤ 60", "required(1)"],
    ["ECOG 3", "required(2)"],
  ])("exclusion %s", (text, want) => expect(exc(text).ecog_max).toBe(want));
  it("is mentioned when no threshold can be read", () => {
    expect(inc("Adequate performance status as judged by the investigator").ecog_max).toBe("mentioned");
  });
  it("maps Karnofsky floors leniently and parses windows directly", () => {
    expect([90, 80, 70, 60, 50, 40, 20].map(kpsToEcog)).toEqual([0, 1, 1, 2, 2, 3, 4]);
    expect(parseEcog(" of 0-1 within 28 days", "inclusion")).toBe(1);
    expect(parseEcog(" assessed within 14 days", "inclusion")).toBeNull();
    expect(parseKpsMin(" ≥ 105", "inclusion")).toBeNull();
    expect(parseKpsMin(" of 70", "exclusion")).toBe(80);
  });
});

describe("brain metastases", () => {
  it("blanket exclusions vs active-only carve-outs", () => {
    expect(exc("Known brain metastases").brain_mets).toBe("excluded");
    expect(exc("Prior diagnosis or treatment of brain metastases or leptomeningeal disease").brain_mets).toBe("excluded");
    expect(exc("Untreated or symptomatic brain metastases.").brain_mets).toBe("excluded(active_only)");
    expect(exc("Known brain metastases unless adequately treated and stable for 4 weeks").brain_mets).toBe("excluded(active_only)");
    expect(exc("Patients with treated, stable brain metastases are eligible.").brain_mets).toBe("excluded(active_only)");
  });
  it("inclusion wording", () => {
    expect(inc("No known brain metastases").brain_mets).toBe("excluded");
    expect(inc("Participants must not have known brain metastases unless adequately treated and stable").brain_mets).toBe("excluded(active_only)");
    expect(inc("Patients with treated brain metastases are eligible if imaging shows no progression").brain_mets).toBe("excluded(active_only)");
    expect(inc("Patients with asymptomatic brain metastases are eligible").brain_mets).toBe("mentioned");
    expect(inc("Must have at least one brain metastasis measuring 5-30 mm").brain_mets).toBe("required");
    expect(inc("Brain metastases or primary brain tumor").brain_mets).toBe("mentioned");
    expect(inc("Patients with brain metastases from melanoma").brain_mets).toBe("mentioned");
  });
  it("examples of a surgery are not brain-mets rules", () => {
    expect(exc("Major surgery (e.g., biopsy of brain metastasis) within 2 weeks").brain_mets).toBe("mentioned");
    expect(exc("No leptomeningeal disease").brain_mets).toBeUndefined();
  });
  it("negated exclusions without a qualifier stay unclear", () => {
    expect(exc("No evidence of brain metastases is required").brain_mets).toBe("mentioned");
  });
});

describe("lines of therapy", () => {
  it.each([
    ["Must have received at least 2 prior lines of systemic therapy", { min_prior_lines: "required(2)" }],
    ["No more than 3 prior lines of therapy", { max_prior_lines: "required(3)" }],
    ["Received 1 to 3 prior lines of therapy", { min_prior_lines: "required(1)", max_prior_lines: "required(3)" }],
    ["Treated with at least 2 but no more than 3 prior lines of systemic therapy", { min_prior_lines: "required(2)", max_prior_lines: "required(3)" }],
    ["Patient must have received only one prior line of therapy", { min_prior_lines: "required(1)", max_prior_lines: "required(1)" }],
    ["Have received >2 prior treatment regimens", { min_prior_lines: "required(3)" }],
    ["Participants must not have received more than one line of prior systemic treatment", { max_prior_lines: "required(1)" }],
    ["3 or fewer lines of prior therapy", { max_prior_lines: "required(3)" }],
    ["Fewer than 4 prior regimens", { max_prior_lines: "required(3)" }],
    ["Two or more prior lines of therapy", { min_prior_lines: "required(2)" }],
  ])("inclusion %s", (text, want) => {
    const f = inc(text);
    expect({ min_prior_lines: f.min_prior_lines, max_prior_lines: f.max_prior_lines }).toEqual({ min_prior_lines: undefined, max_prior_lines: undefined, ...want });
  });
  it("exclusions turn minimums into maximums", () => {
    expect(exc("Has received more than 2 prior lines of systemic therapy").max_prior_lines).toBe("required(2)");
    expect(exc("At least 3 prior lines of therapy").max_prior_lines).toBe("required(2)");
    expect(exc("Has received at least one line, but not more than three lines, of systemic therapy").min_prior_lines).toBeUndefined();
  });
  it("class-specific counts and no-limit text are not total-line rules", () => {
    expect(inc("No more than 1 prior line of VEGF/VEGFR targeted therapy")).not.toHaveProperty("max_prior_lines", "required(1)");
    expect(inc("Up to 2 prior lines of endocrine therapy")).toEqual(expect.not.objectContaining({ max_prior_lines: "required(2)" }));
    expect(parseLines("There is no limit on the number of prior lines", "inclusion")).toBeNull();
    expect(inc("Received at least 1 prior chemotherapy regimen").min_prior_lines).toBeUndefined();
    expect(parseLines("Fewer than 0 prior lines of therapy", "inclusion")).toBeNull();
  });
  it("cohort-specific counts are only mentioned", () => {
    expect(inc("Part 2: at least 2 prior lines of therapy").min_prior_lines).toBe("mentioned");
    expect(inc("Cohort B participants must have received at least 2 prior lines of therapy").min_prior_lines).toBe("mentioned");
  });
});

describe("prior drug classes", () => {
  it("exclusions and requirements", () => {
    expect(exc("Prior treatment with a CDK4/6 inhibitor")["prior_drug:cdk46"]).toBe("excluded");
    expect(inc("Must have progressed on prior anti-PD-1 or anti-PD-L1 therapy")["prior_drug:checkpoint"]).toBe("required");
    expect(inc("Participants must not have prior treatment with an EGFR tyrosine kinase inhibitor")["prior_drug:egfr_tki"]).toBe("excluded");
    expect(inc("Refractory to both a proteasome inhibitor and an IMiD")).toMatchObject({ "prior_drug:proteasome_inhibitor": "required", "prior_drug:imid": "required" });
    expect(inc("Naive to PARP inhibitors")["prior_drug:parp"]).toBe("excluded");
  });
  it("washouts, plans, counts, single drugs and alternatives are only mentioned", () => {
    expect(exc("Prior chemotherapy within 4 weeks, including platinum")["prior_drug:platinum"]).toBe("mentioned");
    expect(inc("Patients eligible for adjuvant CDK4/6 inhibitors after surgery")["prior_drug:cdk46"]).toBeUndefined();
    expect(inc("Prior surgery; now planned to receive a CDK4/6 inhibitor")["prior_drug:cdk46"]).toBe("mentioned");
    expect(inc("Received no more than 1 prior bevacizumab-containing regimen")["prior_drug:anti_vegf"]).toBe("mentioned");
    expect(exc("Prior binimetinib")["prior_drug:braf_mek"]).toBe("mentioned");
    expect(inc("Prior treatment with a taxane or platinum")["prior_drug:taxane"]).toBe("mentioned");
    expect(inc("After platinum chemotherapy with or without a PD-1 inhibitor")["prior_drug:checkpoint"]).toBe("mentioned");
    expect(exc("History of pneumonitis from prior checkpoint inhibitor therapy")["prior_drug:checkpoint"]).toBe("mentioned");
    expect(inc("Pembrolizumab will be given every 3 weeks")["prior_drug:checkpoint"]).toBeUndefined();
  });
});

describe("measurable disease", () => {
  it("requirements and options", () => {
    expect(inc("Measurable disease per RECIST 1.1").measurable_disease).toBe("required");
    expect(inc("Must have measurable disease").measurable_disease).toBe("required");
    expect(inc("Measurable or evaluable disease per RECIST v1.1").measurable_disease).toBe("mentioned");
    expect(inc("Visible disease on imaging (does not have to be measurable by RECIST 1.1)").measurable_disease).toBe("mentioned");
    expect(inc("Lesions in a previously irradiated area are considered measurable if progression is shown").measurable_disease).toBe("mentioned");
    expect(inc("No measurable disease after surgery").measurable_disease).toBe("excluded");
    expect(inc("Non-measurable disease").measurable_disease).toBe("mentioned");
    expect(inc("Measurable residual disease (MRD) positive").measurable_disease).toBeUndefined();
    expect(exc("Measurable disease only in bone").measurable_disease).toBe("mentioned");
    expect(inc("Disease that is measurable").measurable_disease).toBe("mentioned");
  });
});

describe("relapsed / refractory / recurrent", () => {
  it("required, alternatives and unrelated uses", () => {
    expect(inc("Relapsed or refractory multiple myeloma").recurrent).toBe("required");
    expect(inc("Documented disease progression on the most recent therapy").recurrent).toBe("required");
    expect(inc("Recurrent or metastatic head and neck cancer").recurrent).toBe("mentioned");
    expect(inc("Newly diagnosed or relapsed AML").recurrent).toBe("mentioned");
    expect(inc("No evidence of disease recurrence").recurrent).toBeUndefined();
    expect(inc("Recurrently mutated genes in the clone").recurrent).toBeUndefined();
    expect(inc("Refractory to standard therapy or intolerant of it").recurrent).toBe("mentioned");
    expect(exc("Recurrent disease").recurrent).toBe("excluded");
    expect(exc("Relapse within 6 months after transplant").recurrent).toBe("mentioned");
    expect(exc("Patients with a history of disease").recurrent).toBeUndefined();
    expect(exc("Has a disease that progressed").recurrent).toBe("mentioned");
  });
});

describe("other malignancy", () => {
  it("windows, active-only and blanket rules", () => {
    expect(exc("Prior malignancy within the past 3 years, except basal cell carcinoma").other_malignancy).toBe("excluded(3)");
    expect(exc("Other active malignancy requiring treatment").other_malignancy).toBe("excluded(active_only)");
    expect(exc("History of another malignancy").other_malignancy).toBe("excluded");
    expect(exc("History of malignancy unless treated with curative intent").other_malignancy).toBe("excluded(active_only)");
    expect(inc("No other malignancy within five years").other_malignancy).toBe("excluded(5)");
    expect(inc("Prior malignancy allowed").other_malignancy).toBe("mentioned");
  });
  it("judgment, exception headers, specific cancers and washouts are not directional", () => {
    expect(exc("Any prior or concurrent malignancy whose natural history has the potential to interfere with the safety assessment").other_malignancy).toBe("mentioned");
    expect(exc("History of other malignancies, except:").other_malignancy).toBe("mentioned");
    expect(exc("History of colorectal cancer.").other_malignancy).toBe("mentioned");
    expect(exc("Patients who are currently receiving other anti-cancer agents").other_malignancy).toBeUndefined();
    expect(exc("Exceptions: adequately treated skin cancer").other_malignancy).toBeUndefined();
    expect(exc("Prior therapy for this malignancy").other_malignancy).toBeUndefined();
    expect(exc("Other malignancy with a life expectancy < 2 years").other_malignancy).toBe("excluded");
  });
});

describe("HIV and hepatitis", () => {
  it("HIV", () => {
    expect(exc("Known history of HIV infection").hiv).toBe("excluded");
    expect(exc("Uncontrolled HIV infection").hiv).toBe("excluded(uncontrolled_only)");
    expect(exc("Active hepatitis B or C, or known HIV").hiv).toBe("excluded");
    expect(inc("HIV-infected patients on effective anti-retroviral therapy with undetectable viral load are eligible").hiv).toBe("excluded(uncontrolled_only)");
    expect(inc("HIV-associated lymphoma").hiv).toBe("required");
    expect(inc("HIV negative").hiv).toBe("excluded");
    expect(inc("HIV status will be recorded").hiv).toBe("mentioned");
    expect(exc("Immunodeficiency such as AIDS").hiv).toBe("excluded(uncontrolled_only)");
    expect(exc("HIV testing is not required").hiv).toBeUndefined();
    expect(exc("Not HIV related").hiv).toBe("mentioned");
  });
  it("hepatitis", () => {
    expect(exc("Active hepatitis B or C infection")).toMatchObject({ hepatitis_b: "excluded(active_only)", hepatitis_c: "excluded(active_only)" });
    expect(exc("HBsAg reactive or HCV antibody positive")).toMatchObject({ hepatitis_b: "excluded", hepatitis_c: "excluded" });
    expect(exc("Active or chronic hepatitis B")).toMatchObject({ hepatitis_b: "excluded" });
    expect(inc("Negative hepatitis B surface antigen (HBsAg) test at screening").hepatitis_b).toBe("excluded");
    expect(inc("HBV-related hepatocellular carcinoma").hepatitis_b).toBe("required");
    expect(inc("Subjects with HCV-HCC are eligible").hepatitis_c).toBe("mentioned");
    expect(inc("Participants with HBV must be on antiviral therapy").hepatitis_b).toBe("excluded(active_only)");
    expect(exc("HBV DNA and HCV RNA testing are required at screening").hepatitis_b).toBe("mentioned");
    expect(exc("Patients with hepatitis C cleared by previous therapy are allowed").hepatitis_c).toBe("excluded(active_only)");
    expect(inc("Hepatitis B vaccination history").hepatitis_b).toBeUndefined();
    expect(inc("Hepatitis C status").hepatitis_c).toBe("mentioned");
    expect(exc("Not hepatitis B carriers").hepatitis_b).toBe("mentioned");
  });
});

describe("transplant, autoimmune, organ disease", () => {
  it("transplant", () => {
    expect(exc("Prior solid organ transplant")).toMatchObject({ organ_transplant: "excluded" });
    expect(exc("Prior allogeneic stem cell transplant").allo_sct).toBe("excluded");
    expect(exc("Prior organ allograft").allo_sct).toBeUndefined();
    expect(exc("Allogeneic stem cell transplant within 6 months").allo_sct).toBe("mentioned");
    expect(exc("Organ transplant within 3 months").organ_transplant).toBe("mentioned");
    expect(inc("Must have relapsed after prior allogeneic stem cell transplant").allo_sct).toBe("required");
    expect(inc("Candidates for allogeneic stem cell transplant").allo_sct).toBe("mentioned");
    expect(inc("No prior allogeneic stem cell transplant").allo_sct).toBe("excluded");
    expect(inc("No history of liver transplantation").organ_transplant).toBe("excluded");
    expect(inc("Liver transplant recipients").organ_transplant).toBe("mentioned");
  });
  it("autoimmune", () => {
    expect(exc("Active autoimmune disease requiring systemic treatment in the past 2 years").autoimmune).toBe("excluded(active_only)");
    expect(exc("History of autoimmune disease").autoimmune).toBe("excluded");
    expect(exc("Autoimmune disease affecting hair").autoimmune).toBe("mentioned");
    expect(inc("Steroids are permitted in absence of active autoimmune disease").autoimmune).toBe("mentioned");
    expect(inc("No active autoimmune disease").autoimmune).toBe("excluded(active_only)");
    // An example inside a vague catch-all ("serious illness (e.g., ...)") does not exclude every autoimmune patient.
    expect(exc("Serious illness (e.g., autoimmune disease)").autoimmune).toBe("mentioned");
    expect(exc("Exceptions: autoimmune hypothyroidism").autoimmune).toBeUndefined();
    expect(exc("Exceptions: autoimmune disease").autoimmune).toBe("mentioned");
  });
  it("organ disease (named diseases only)", () => {
    expect(exc("Congestive heart failure (NYHA class III or IV)").heart_disease).toBe("excluded");
    expect(exc("Patients on dialysis").kidney_disease).toBe("excluded");
    expect(exc("Liver cirrhosis Child-Pugh B or C").liver_disease).toBe("excluded");
    expect(exc("LVEF < 50% or heart failure below ULN").heart_disease).toBe("mentioned");
    expect(inc("No patients on dialysis").kidney_disease).toBe("excluded");
    expect(inc("Patients on dialysis are eligible").kidney_disease).toBe("mentioned");
    expect(exc("Intercurrent illness (e.g., heart failure)").heart_disease).toBe("excluded");
    expect(exc("Conditions such as heart failure").heart_disease).toBe("mentioned");
  });
});

describe("group status and stage", () => {
  it("prostate, ovarian, bladder, thyroid, resectability", () => {
    expect(inc("Metastatic castration-resistant prostate cancer").castration_resistant).toBe("required");
    expect(inc("Metastatic hormone-sensitive prostate cancer").castration_resistant).toBe("excluded");
    expect(exc("Castration-resistant prostate cancer").castration_resistant).toBe("excluded");
    expect(exc("Hormone-sensitive disease").castration_resistant).toBe("mentioned");
    expect(inc("Platinum-resistant ovarian cancer").platinum_resistant).toBe("required");
    expect(inc("Platinum-resistant or platinum-sensitive disease")).toMatchObject({ platinum_resistant: "mentioned", platinum_sensitive: "mentioned" });
    expect(inc("Platinum-sensitive recurrent ovarian cancer").platinum_sensitive).toBe("required");
    expect(inc("Muscle-invasive bladder cancer").mibc).toBe("required");
    expect(inc("Non-muscle invasive bladder cancer").mibc).toBe("excluded");
    expect(inc("Radioactive iodine-refractory differentiated thyroid cancer").rai_refractory).toBe("required");
    expect(inc("Unresectable or metastatic melanoma").resectable).toBe("excluded");
    expect(inc("Resectable pancreatic adenocarcinoma").resectable).toBe("required");
    expect(inc("Borderline resectable pancreatic cancer").resectable).toBe("mentioned");
    expect(inc("Platinum refractory is defined as progression during platinum therapy").platinum_resistant).toBeUndefined();
    expect(inc("Measurable disease (per PCWG3 for patients with mCRPC)").castration_resistant).toBe("mentioned");
    expect(exc("Prior radioisotope therapy for castration-resistant prostate cancer").castration_resistant).toBe("mentioned");
    expect(inc("Not castration-resistant").castration_resistant).toBe("excluded");
  });
  it("locally advanced and adjuvant setting", () => {
    expect(inc("Locally advanced pancreatic cancer per NCCN").locally_advanced).toBe("required");
    expect(inc("Locally advanced or metastatic NSCLC").locally_advanced).toBe("mentioned");
    expect(inc("Completely resected stage III melanoma").adjuvant_setting).toBe("required");
    expect(inc("No evidence of disease progression").adjuvant_setting).toBeUndefined();
    expect(inc("Complete surgical resection must be deemed achievable").adjuvant_setting).toBe("mentioned");
    expect(inc("Adequate organ function deﬁned as:").adjuvant_setting).toBeUndefined();
    expect(exc("Locally advanced disease").locally_advanced).toBe("mentioned");
  });
});

describe("histology", () => {
  it("only runs for the trial's own groups", () => {
    expect(inc("Histologically confirmed small cell lung cancer", ["lung"])["histology:sclc"]).toBe("required");
    expect(inc("Histologically confirmed small cell lung cancer", ["breast"])["histology:sclc"]).toBeUndefined();
  });
  it("lists, negations, asides and exclusions", () => {
    expect(inc("Histologically confirmed NSCLC or SCLC", ["lung"])["histology:nsclc"]).toBe("mentioned");
    expect(inc("Histologically confirmed non-squamous NSCLC", ["lung"])).toMatchObject({ "histology:lung_squamous": "excluded", "histology:nsclc": "required" });
    expect(inc("Subjects must not have received prior therapy for CLL", ["leukemia"])["histology:cll"]).toBe("mentioned");
    expect(exc("Mixed small cell lung cancer histology", ["lung"])["histology:sclc"]).toBe("excluded");
    expect(exc("Investigational treatment for rectal cancer within the past month", ["colorectal"])["histology:rectal"]).toBe("mentioned");
    expect(inc("Diagnosis of AML, MDS, or CMML", ["leukemia"])["histology:aml"]).toBe("mentioned");
    expect(inc("Clear cell renal cell carcinoma component", ["kidney"])["histology:clear_cell_rcc"]).toBe("mentioned");
    expect(inc("Patients with uveal melanoma", ["melanoma"])["histology:uveal_melanoma"]).toBe("required");
    expect(inc("Measurable disease per RANO", ["brain"])).toEqual({ measurable_disease: "required" });
    expect(inc("No small cell lung cancer component", ["lung"])["histology:sclc"]).toBe("excluded");
    expect(exc("Non-clear cell histology", ["kidney"])["histology:clear_cell_rcc"]).toBe("mentioned");
    expect(inc("Glioblastoma", ["brain"])["histology:glioblastoma"]).toBe("required");
  });
});

describe("cohort guard and helpers", () => {
  it("cohort-specific clauses are never directional (except performance status)", () => {
    expect(cohortSpecific("Cohort A: HER2-positive")).toBe(true);
    expect(cohortSpecific("Dose escalation: any solid tumor")).toBe(true);
    expect(cohortSpecific("Adults with cancer")).toBe(false);
    expect(inc("Part B: measurable disease per RECIST")).toEqual({ measurable_disease: "mentioned" });
    expect(inc("Part B: ECOG 0-1").ecog_max).toBe("required(1)");
    // A header criterion makes every clause in it cohort-specific.
    const got = factsForCriterion("inclusion", "Additional inclusion criteria for participants with mCRPC:\n* Measurable disease per RECIST", { v2: true });
    expect(got.find((f) => f.key === "measurable_disease")?.value).toBe("mentioned");
  });
  it("familyOf and lenient merge", () => {
    expect(familyOf("histology:sclc")).toBe("histology");
    expect(familyOf("biomarker:MET")).toBe("biomarker_v2");
    expect(familyOf("biomarker:HER2")).toBeNull();
    expect(familyOf("metastatic")).toBeNull();
    expect(moreLenient("ecog_max", { value: "required", param: 1 }, { value: "required", param: 2 })).toBe(true);
    expect(moreLenient("min_prior_lines", { value: "required", param: 2 }, { value: "required", param: 1 })).toBe(true);
    expect(moreLenient("brain_mets", { value: "excluded" }, { value: "excluded", param: "active_only" })).toBe(true);
    expect(moreLenient("other_malignancy", { value: "excluded", param: 3 }, { value: "excluded", param: "active_only" })).toBe(true);
    expect(moreLenient("brain_mets", { value: "excluded", param: "active_only" }, { value: "excluded" })).toBe(false);
    expect(moreLenient("brain_mets", { value: "excluded" }, { value: "required" })).toBe(false);
    expect(moreLenient("hiv", { value: "excluded", param: "uncontrolled_only" }, { value: "excluded", param: "uncontrolled_only" })).toBe(false);
  });
  it("inclusion text phrased as an exclusion counts as exclusion, unless conditional", () => {
    expect(inc("Patients with known HIV are not eligible").hiv).toBe("excluded");
    expect(inc("Patients with prior checkpoint inhibitor therapy unless not eligible")["prior_drug:checkpoint"]).toBe("mentioned");
  });
});

describe("extractRuleFacts with v2 families", () => {
  const inclusion = [
    { n: 1, text: "Histologically confirmed small cell lung cancer" },
    { n: 2, text: "ECOG performance status 0-1. Part B: ECOG 0-2" },
    { n: 3, text: "Measurable disease per RECIST 1.1" },
  ];
  const exclusion = [
    { n: 1, text: "Known brain metastases" },
    { n: 2, text: "Untreated or symptomatic brain metastases" },
    { n: 3, text: "Prior malignancy within 3 years. Prior malignancy within 5 years" },
  ];
  const facts = extractRuleFacts(inclusion, exclusion, ["lung"]);
  const get = (k: string) => facts.find((f) => f.key === k);
  it("quotes the clause verbatim and merges parameters leniently", () => {
    expect(get("histology:sclc")).toMatchObject({ value: "required", quote: "Histologically confirmed small cell lung cancer", ref: { section: "inclusion", n: 1 } });
    expect(get("ecog_max")).toMatchObject({ value: "required", param: 2 });
    expect(get("brain_mets")).toMatchObject({ value: "excluded", param: "active_only", ref: { section: "exclusion", n: 2 } });
    expect(get("other_malignancy")).toMatchObject({ value: "excluded", param: 3 });
    for (const f of facts) expect([...inclusion, ...exclusion].some((c) => c.text.includes(f.quote))).toBe(true);
  });
  it("v1 assertions are unaffected unless v2 is requested", () => {
    expect(factsForCriterion("exclusion", "Known HIV infection")).toEqual([]);
    expect(factsForCriterion("exclusion", "Known HIV infection", { v2: true })).toEqual([expect.objectContaining({ key: "hiv", value: "excluded" })]);
  });
});

describe("precision guards", () => {
  it("lines: ceilings, alternatives, subgroups and class-specific counts stay mentioned", () => {
    expect(inc("Only 1 prior line of systemic therapy is allowed").min_prior_lines).toBeUndefined();
    expect(inc("Only 1 prior line of systemic therapy is allowed").max_prior_lines).toBe("required(1)");
    expect(inc("Patients may have received 1-2 prior lines of systemic therapy")).toMatchObject({ max_prior_lines: "required(2)" });
    expect(inc("Has relapsed disease and is ineligible for ASCT and failed at least 2 lines of prior therapy.").min_prior_lines).toBe("required(2)");
    expect(inc("Must have 2 or more prior lines, unless no standard therapy exists").min_prior_lines).toBe("mentioned");
    expect(inc("NK cell leukemia: at least 1 prior line of therapy").min_prior_lines).toBe("mentioned");
    expect(inc("Have received > one prior line of therapy in any setting with a PARPi-based regimen").min_prior_lines).toBe("mentioned");
    expect(inc("Disease progression after at least 1 prior line OR refractory to initial therapy").min_prior_lines).toBe("mentioned");
  });
  it("prior drugs: reproductive, timing, conditional and negated-list wording", () => {
    expect(inc("Men must use a condom for 6 months after the final dose of atezolizumab")["prior_drug:checkpoint"]).toBe("mentioned");
    expect(inc("Prior bevacizumab is allowed; at least 6 weeks must have elapsed")["prior_drug:anti_vegf"]).toBe("mentioned");
    expect(inc("If BRAF V600 mutation-positive, subject previously failed a BRAF inhibitor")["prior_drug:braf_mek"]).toBe("mentioned");
    expect(inc("No previous chemotherapy, anti-HER2 therapy, immunotherapy or endocrine therapy")).toMatchObject({ "prior_drug:endocrine": "excluded", "prior_drug:anti_her2": "excluded" });
    expect(inc("Not refractory to bortezomib")["prior_drug:proteasome_inhibitor"]).toBe("mentioned");
    expect(exc("Exposure to a Bcl-2 inhibitor within the last 12 months")["prior_drug:venetoclax"]).toBe("mentioned");
    expect(exc("Platinum refractory disease")["prior_drug:platinum"]).toBe("mentioned");
    expect(exc("Prior treatment with a PARP inhibitor")["prior_drug:parp"]).toBe("excluded");
  });
  it("histology: own-disease gating, qualifiers and bare bullets", () => {
    const ctx = (conditions: string[], groups: CancerGroupId[]) => ({ groups, conditions });
    const h = (s: "inclusion" | "exclusion", t: string, c: string[], g: CancerGroupId[]) => Object.fromEntries(v2FactsForSegment(s, t, ctx(c, g)).map((f) => [f.key, f.value]));
    expect(h("inclusion", "Histologically confirmed diagnosis of AML", ["Acute Myeloid Leukemia"], ["leukemia"])["histology:aml"]).toBe("required");
    expect(h("inclusion", "Histologically confirmed diagnosis of AML", ["Acute Myeloid Leukemia", "Chronic Lymphocytic Leukemia"], ["leukemia"])["histology:aml"]).toBe("mentioned");
    expect(h("exclusion", "Philadelphia chromosome-positive ALL", ["Acute Myeloid Leukemia"], ["leukemia"])["histology:all"]).toBe("excluded");
    expect(h("exclusion", "Ph+ AML", ["Leukemia"], ["leukemia"])["histology:aml"]).toBe("mentioned");
    expect(h("exclusion", "Grade 3B follicular lymphoma", ["Indolent lymphoma"], ["lymphoma"])["histology:follicular"]).toBe("mentioned");
    expect(h("inclusion", "* Angioimmunoblastic T-cell lymphoma", ["Peripheral T Cell Lymphoma"], ["lymphoma"])["histology:t_cell_lymphoma"]).toBe("mentioned");
    expect(h("exclusion", "Small cell lung cancer histology.", ["Non Small Cell Lung Cancer"], ["lung"])["histology:sclc"]).toBe("excluded");
  });
  it("stage, recurrent, other cancer, hepatitis, autoimmune and biomarker guards", () => {
    expect(inc("All visible tumor must be completely resected prior to TURBT").adjuvant_setting).toBe("mentioned");
    expect(inc("Patients must have undergone complete surgical resection (R0).").adjuvant_setting).toBe("required");
    expect(inc("Locally advanced disease must not be amenable to curative surgery").locally_advanced).toBe("mentioned");
    expect(inc("Relapsed/refractory disease after 1 line of therapy").recurrent).toBe("required");
    expect(inc("Progressive disease manifest by either:").recurrent).toBeUndefined();
    expect(inc("Refractory epilepsy requiring medication").recurrent).toBeUndefined();
    expect(exc("Prior history of malignancy unless treated with curative intent and disease-free for at least 3 years").other_malignancy).toBe("excluded(3)");
    expect(exc("Prior malignancy unless treated with curative intent or in remission for 3 years").other_malignancy).toBe("excluded(active_only)");
    expect(exc("Known active Hepatitis B (e.g., HBsAg reactive) or Hepatitis C").hepatitis_b).toBe("excluded(active_only)");
    expect(exc("Chronic or active hepatitis B infection").hepatitis_b).toBe("excluded");
    expect(exc("Active bacterial infection (except Hepatitis B or C infections)").hepatitis_b).toBe("mentioned");
    expect(exc("HBV DNA and HCV RNA PCR testing are required at screening for patients with a positive history").hepatitis_c).toBe("mentioned");
    expect(exc("History of autoimmune disease requiring systemic immunosuppression within the last 90 days").autoimmune).toBe("excluded(active_only)");
    expect(exc("Active or history of autoimmune diseases, including lupus").autoimmune).toBe("excluded");
  });
  it("v2 biomarkers read permissive, procedural and subgroup wording as mentioned", () => {
    const b = (s: "inclusion" | "exclusion", t: string) => factsForCriterion(s, t, { v2: true, groups: ["breast"] }).find((f) => f.key === "biomarker:PIK3CA")?.value;
    expect(b("inclusion", "Confirmed PIK3CA mutation")).toBe("required");
    expect(b("inclusion", "PIK3CA mutation status confirmed by NGS")).toBe("mentioned");
    expect(b("inclusion", "Other PIK3CA mutations may be considered but must be approved by the Sponsor")).toBe("mentioned");
    expect(b("inclusion", "Available tumor tissue sample for detection of PIK3CA mutation")).toBe("mentioned");
    expect(b("inclusion", "* PIK3CA mutation")).toBe("mentioned");
  });
  it("criterion-level alternatives header and exception-list windows", () => {
    const f = factsForCriterion("inclusion", "Histologically confirmed disease of one of the following indications:\n* Relapsed or refractory disease after at least 2 lines of therapy", { v2: true, groups: ["lymphoma"] });
    expect(f.find((x) => x.key === "min_prior_lines")?.value).toBe("mentioned");
  });
  it("partitionOf is deterministic and splits trials", async () => {
    const mod = await import("@/lib/ingest/precision");
    expect(mod.PRECISION_GATE).toBe(0.85);
  });
});
