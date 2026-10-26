import { describe, expect, it } from "vitest";
import { CRITERIA_VERSION, scopeHeader, sectionHeader, splitCriteria, splitSegments } from "@/lib/ingest/criteria-split";
import { boundaryCounts, goldItems, oursFlat, summarize, compareTrial, textSimilarity } from "@/scripts/eval/trialgpt/compare";

const texts = (raw: string) => splitCriteria(raw).map((c) => `${c.id}${c.scope ? `[${c.scope}]` : ""}: ${c.text}`);

/** Fixtures: [name, raw CT.gov text, expected `id[scope]: text` lines]. Synthetic text in CT.gov's markdown style. */
const FIXTURES: [string, string, string[]][] = [
  ["star bullets with both headers", "Inclusion Criteria:\n\n* Age >= 18\n* ECOG 0-1\n\nExclusion Criteria:\n\n* Pregnant", ["I1: Age >= 18", "I2: ECOG 0-1", "E1: Pregnant"]],
  ["dash bullets", "Inclusion Criteria:\n- Adults\n- Signed consent", ["I1: Adults", "I2: Signed consent"]],
  ["unicode bullets", "Inclusion Criteria:\n• Adults\n• Signed consent\n· Measurable disease", ["I1: Adults", "I2: Signed consent", "I3: Measurable disease"]],
  ["numbered with period", "Inclusion Criteria:\n\n1. Age 18 or older\n2. Breast cancer\n10. Consent", ["I1: Age 18 or older", "I2: Breast cancer", "I3: Consent"]],
  ["numbered with paren", "Inclusion Criteria:\n1) Age 18 or older\n2) Breast cancer", ["I1: Age 18 or older", "I2: Breast cancer"]],
  ["lettered list", "Exclusion Criteria:\na. Pregnancy\nb. Active infection", ["E1: Pregnancy", "E2: Active infection"]],
  ["no headers at all: inclusion", "* Age over 18\n* Lung cancer", ["I1: Age over 18", "I2: Lung cancer"]],
  ["text before any header is inclusion", "Adults with lung cancer.\n\nExclusion Criteria:\n\n* Pregnancy", ["I1: Adults with lung cancer.", "E1: Pregnancy"]],
  ["unbulleted paragraphs", "Healthy adults.\n\nNo other conditions.", ["I1: Healthy adults.", "I2: No other conditions."]],
  [
    "nested sub-bullets stay with the parent",
    "Inclusion Criteria:\n\n* Adequate organ function:\n\n  * ANC >= 1500\n  * Platelets >= 100,000\n* ECOG 0-1",
    ["I1: Adequate organ function:\n- ANC >= 1500\n- Platelets >= 100,000", "I2: ECOG 0-1"],
  ],
  [
    "three levels of nesting",
    "Inclusion Criteria:\n\n* Disease:\n  * Stage IV\n    * with measurable lesion\n* Consent",
    ["I1: Disease:\n- Stage IV\n  - with measurable lesion", "I2: Consent"],
  ],
  [
    "one of the following list stays whole (nested)",
    "Inclusion Criteria:\n\n* Must have one of the following:\n\n  * EGFR mutation\n  * ALK fusion\n* Age >= 18",
    ["I1: Must have one of the following:\n- EGFR mutation\n- ALK fusion", "I2: Age >= 18"],
  ],
  [
    "unbulleted one-of label groups the same-level bullets under it",
    "Inclusion Criteria:\n\nPatients must meet one of the following:\n\n* Prior surgery\n* Prior radiation\n\nAge 18 or older.",
    ["I1: Patients must meet one of the following:\n- Prior surgery\n- Prior radiation", "I2: Age 18 or older."],
  ],
  [
    "unbulleted label with indented children is one item",
    "Inclusion Criteria:\n\nAdequate labs defined as:\n\n  * Hemoglobin >= 9\n  * Creatinine <= 1.5 ULN\n\nExclusion Criteria:\n\n* HIV",
    ["I1: Adequate labs defined as:\n- Hemoglobin >= 9\n- Creatinine <= 1.5 ULN", "E1: HIV"],
  ],
  [
    "generic category label over same-level bullets is dropped",
    "DISEASE CHARACTERISTICS:\n\n* Histologically confirmed melanoma\n* Stage III\n\nPATIENT CHARACTERISTICS:\n\n* Age 18 and over",
    ["I1: Histologically confirmed melanoma", "I2: Stage III", "I3: Age 18 and over"],
  ],
  ["never splits on and/or", "Inclusion Criteria:\n\n* Prior chemotherapy and radiation or surgery", ["I1: Prior chemotherapy and radiation or surgery"]],
  [
    "standalone OR line joins its neighbours",
    "Inclusion Criteria:\n\n* Locally advanced disease\n\nOR\n\n* Metastatic disease\n* Consent",
    ["I1: Locally advanced disease\nOR\nMetastatic disease", "I2: Consent"],
  ],
  [
    "cohort headers set scope",
    "Inclusion Criteria:\n\n* Age >= 18\n\nCohort A:\n\n* NSCLC\n* EGFR mutation\n\nCohort B:\n\n* Melanoma",
    ["I1: Age >= 18", "I2[Cohort A]: NSCLC", "I3[Cohort A]: EGFR mutation", "I4[Cohort B]: Melanoma"],
  ],
  [
    "bulleted part header with nested children",
    "Inclusion Criteria:\n\n* Part 1:\n\n  * Solid tumor\n  * No standard therapy\n* Signed consent",
    ["I1[Part 1]: Solid tumor", "I2[Part 1]: No standard therapy", "I3: Signed consent"],
  ],
  [
    "for patients in arm header",
    "Inclusion Criteria:\n\nFor patients in Arm B:\n\n* Prior PD-1 therapy\n\nExclusion Criteria:\n\n* HIV",
    ["I1[Arm B]: Prior PD-1 therapy", "E1: HIV"],
  ],
  ["scope in section header", "Inclusion Criteria for Part B:\n\n* Prostate cancer\n\nExclusion Criteria:\n\n* Prior docetaxel", ["I1[Part B]: Prostate cancer", "E1: Prior docetaxel"]],
  ["parenthetical scope in header", "Exclusion Criteria (Dose Expansion):\n\n* Brain metastases", ["E1[Dose Expansion]: Brain metastases"]],
  ["bare scope label without colon", "Phase 1\n\n* Age >= 18\n\nPhase 2\n\n* Age >= 21", ["I1[Phase 1]: Age >= 18", "I2[Phase 2]: Age >= 21"]],
  ["scope reset by all-patients header", "Cohort A:\n\n* NSCLC\n\nAll patients:\n\n* Consent", ["I1[Cohort A]: NSCLC", "I2: Consent"]],
  ["inline cohort prefix sets scope", "Inclusion Criteria:\n\n* Cohort 2: prior platinum therapy", ["I1[Cohort 2]: Cohort 2: prior platinum therapy"]],
  ["key inclusion/exclusion headers", "Key Inclusion Criteria:\n\n* Age >= 18\n\nKey Exclusion Criteria:\n\n* Pregnancy", ["I1: Age >= 18", "E1: Pregnancy"]],
  ["upper-case bulleted headers", "* INCLUSION CRITERIA:\n\n  * Adults\n\n* EXCLUSION CRITERIA:\n\n  * Children", ["I1: Adults", "E1: Children"]],
  ["markdown bold and heading headers", "**Inclusion Criteria:**\n\n* Adults\n\n## Exclusion Criteria\n\n* Children", ["I1: Adults", "E1: Children"]],
  ["header with inline criterion", "Inclusion Criteria: Age 18 or older\n\nExclusion Criteria: Pregnant women", ["I1: Age 18 or older", "E1: Pregnant women"]],
  ["header filler words", "Inclusion criteria include:\n\n* Adults\n\nExclusion criteria are as follows:\n\n* Children", ["I1: Adults", "E1: Children"]],
  ["prefix-named section header sets scope", "Donor Inclusion Criteria:\n\n* Related donor\n\nRecipient Exclusion Criteria:\n\n* Active infection", ["I1[Donor]: Related donor", "E1[Recipient]: Active infection"]],
  ["non-inclusion criteria means exclusion", "Inclusion criteria:\n\n* Adults\n\nNon-inclusion criteria:\n\n* Diabetes", ["I1: Adults", "E1: Diabetes"]],
  ["exclusion of ... is a criterion, not a header", "* Exclusion of patients with HIV is required by the sponsor", ["I1: Exclusion of patients with HIV is required by the sponsor"]],
  ["markdown escapes removed, whitespace collapsed", "Inclusion Criteria:\n\n*   Creatinine \\>  1.5   x ULN\t", ["I1: Creatinine > 1.5 x ULN"]],
  ["CRLF line endings", "Inclusion Criteria:\r\n\r\n* Adults\r\n* Consent\r\n", ["I1: Adults", "I2: Consent"]],
  ["continuation line kept with its bullet", "Inclusion Criteria:\n\n* Hemoglobin >= 9 g/dL\n\n  NOTE: transfusion allowed\n* Consent", ["I1: Hemoglobin >= 9 g/dL\nNOTE: transfusion allowed", "I2: Consent"]],
  ["html comment separators ignored", "Inclusion Criteria:\n\n1. Adults\n\n<!-- -->\n\n1. CD20-positive", ["I1: Adults", "I2: CD20-positive"]],
  ["letters under numbers are nested", "Inclusion Criteria:\n\n1. Adequate function:\na. ANC >= 1500\nb. Platelets >= 100k\n2. Consent", ["I1: Adequate function:\n- ANC >= 1500\n- Platelets >= 100k", "I2: Consent"]],
  ["decimals are not bullets", "Inclusion Criteria:\n\n* Dose of 2.5 mg allowed\n2.5 mg/kg is the cap", ["I1: Dose of 2.5 mg allowed\n2.5 mg/kg is the cap"]],
  ["empty and whitespace-only input", "   \n\n  ", []],
  ["stray blank bullets ignored", "Inclusion Criteria:\n\n*\n* Adults", ["I1: Adults"]],
];

describe("splitCriteria fixtures", () => {
  it("has at least 30 fixtures", () => expect(FIXTURES.length).toBeGreaterThanOrEqual(30));
  for (const [name, raw, want] of FIXTURES) it(name, () => expect(texts(raw)).toEqual(want));
});

describe("splitCriteria contract", () => {
  it("numbers ids I1..In and E1..En per section and is deterministic", () => {
    const raw = "Inclusion Criteria:\n\n* A1\n* A2\n\nExclusion Criteria:\n\n* B1\n* B2\n* B3";
    const a = splitCriteria(raw);
    expect(a.map((c) => c.id)).toEqual(["I1", "I2", "E1", "E2", "E3"]);
    expect(a.every((c) => c.section === (c.id.startsWith("I") ? "inclusion" : "exclusion"))).toBe(true);
    expect(splitCriteria(raw)).toEqual(a);
    expect(CRITERIA_VERSION).toBe(2);
  });
  it("drops label-only heading items but keeps real criteria that mention criteria", () => {
    const raw = "Inclusion Criteria:\n\n* Criteria:\n* Age >= 18\n* Patient Eligibility Criteria:\n* No exclusion criteria\n\nExclusion Criteria:\n\n* Does not meet inclusion criteria";
    expect(texts(raw)).toEqual(["I1: Age >= 18", "I2: No exclusion criteria", "E1: Does not meet inclusion criteria"]);
  });
  it("keeps text verbatim apart from whitespace and escapes", () => {
    const raw = "Inclusion Criteria:\n\n* Histologically confirmed (biopsy-proven) NSCLC; stage IIIB/IV [AJCC v8]";
    expect(splitCriteria(raw)[0]?.text).toBe("Histologically confirmed (biopsy-proven) NSCLC; stage IIIB/IV [AJCC v8]");
  });
  it("handles undefined-ish input", () => expect(splitCriteria(undefined as unknown as string)).toEqual([]));
});

describe("header helpers", () => {
  it("sectionHeader recognises variants and rejects prose", () => {
    expect(sectionHeader("Inclusion Criteria:")).toEqual({ section: "inclusion" });
    expect(sectionHeader("EXCLUSION CRITERIA")).toEqual({ section: "exclusion" });
    expect(sectionHeader("Eligibility Criteria:")).toEqual({ section: null });
    expect(sectionHeader("Inclusion Criteria - HL participant:")).toEqual({ section: "inclusion", scope: "HL participant" });
    expect(sectionHeader("Inclusion Criteria Patient")).toEqual({ section: "inclusion" });
    expect(sectionHeader("Inclusion criteria were met by all patients in the prior study")).toBeNull();
    expect(sectionHeader("Exclusion of patients with HIV")).toBeNull();
  });
  it("scopeHeader accepts cohort labels and rejects criteria mentioning a phase", () => {
    expect(scopeHeader("Cohort A:")).toBe("Cohort A");
    expect(scopeHeader("Dose Expansion Phase:")).toBe("Dose Expansion Phase");
    expect(scopeHeader("For participants enrolled in Part 2:")).toBe("Part 2");
    expect(scopeHeader("All cohorts:")).toBe("");
    expect(scopeHeader("Must have completed phase 2 therapy including the following:")).toBeNull();
    expect(scopeHeader("Adequate organ function:")).toBeNull();
  });
});

describe("splitSegments (gold granularity)", () => {
  it("emits every bullet, continuation and header as its own segment", () => {
    const segs = splitSegments("Inclusion Criteria:\n\n* Parent:\n\n  * Child\n\n  Note text\n\nOR\n\n* Next");
    expect(segs.map((s) => `${s.kind}:${s.depth}`)).toEqual(["header:0", "bullet:0", "bullet:1", "cont:1", "connector:1", "bullet:0"]);
  });
});

describe("TrialGPT gold comparison helpers", () => {
  const gold = { inclusion: "inclusion criteria: \n\n Age >= 18 \n\n ECOG 0-1", exclusion: " \n\n Pregnant women" };
  const raw = "Inclusion Criteria:\n\n* Age >= 18\n* ECOG 0-1\n\nExclusion Criteria:\n\n* Pregnant women";
  it("parses gold items like TrialGPT (drops header and tiny chunks)", () => {
    expect(goldItems(gold)).toEqual({ inclusion: ["Age >= 18", "ECOG 0-1"], exclusion: ["Pregnant women"] });
  });
  it("scores a perfect split as exact with boundary F1 1", () => {
    const r = compareTrial("NCT00000001", raw, gold);
    expect(r.flat).toBe(3);
    expect(r.flatSectionsExact).toBe(true);
    const s = summarize([r]);
    expect(s.flatExact).toBe(1);
    expect(s.f1).toBe(1);
    expect(textSimilarity(raw, `${gold.inclusion}\n${gold.exclusion}`)).toBeGreaterThan(0.6);
  });
  it("penalises a merged boundary", () => {
    const merged = oursFlat("Inclusion Criteria:\n\n* Age >= 18 ECOG 0-1\n\nExclusion Criteria:\n\n* Pregnant women");
    const b = boundaryCounts(merged, goldItems(gold));
    expect(b).toEqual({ tp: 1, pred: 2, gold: 3 });
    expect(summarize([])).toMatchObject({ trials: 0, f1: 0 });
  });
});
