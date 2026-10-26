/** Item shape: windows, alternatives, residual content. Part of the criterion resolver (./index.ts). */
import { BIOMARKERS } from "@/config/biomarkers";
import { canonicalDrug, canonicalGene } from "@/lib/ingest/synonyms";
import type { ResolverProfile } from "./profile";
import { groupTerms } from "./demographics";

/**
 * "within 28 days prior to randomization", "performed within 7 days before registration": when the test is done, not
 * when something happened to the patient. Removed before the time-window check.
 */
export const ASSESSMENT_WINDOW = /\b(?:ECOG|performance status|Zubrod|Karnofsky|evaluation|assessment|assessed|performed|obtained|documented|measured|evaluated|laboratory|labs?|scans?|imaging|tests?|tested|testing)\b[^.;]{0,60}?within\s+(?:the\s+)?\d+\s+(?:days?|weeks?)\s+(?:prior to|before|of|preceding)\s+(?:the\s+)?(?:date of\s+|first\s+|start of\s+|initiation of\s+)?(?:randomi[sz]ation|registration|enrol?lment|allocation|study entry|screening|study treatment|study drug|treatment start|dosing|first dose|cycle 1|C1D1|baseline|protocol therapy|study (?:entry|start))\b/gi;
/** "Stage IV Breast Cancer:" names the disease the item is about, not a study stage (cohort). */
export const STAGE_LABEL = /^\W*stage\s*(?:iv|4|i{1,3}|[1-3])[a-c]?\s+(?:\w+\s+){0,3}?(?:cancer|carcinoma|disease|tumou?rs?|nsclc|sclc|melanoma|lymphoma|myeloma|sarcoma)\s*:\s*/i;
/**
 * Pairs the whole-item extractor would read as options although they name one attribute ("advanced or metastatic",
 * "histologically or cytologically confirmed"): collapsed to one word in the text the extractor sees.
 */
export const EXTRACT_COLLAPSE: [RegExp, string][] = [
  [/\b(?:locally advanced|locally recurrent|advanced|unresectable|inoperable|incurable|recurrent)\b(?:\s*(?:,|\/|or|and\/or|and)\s*(?:locally advanced|locally recurrent|advanced|unresectable|inoperable|incurable|recurrent)\b)*\s*(?:,|\/|or|and\/or|and)\s*metastatic\b/gi, "metastatic"],
  [/\bmetastatic\b\s*(?:,|\/|or|and\/or|and)\s*(?:locally advanced|locally recurrent|advanced|unresectable|inoperable|incurable|recurrent)\b(?:\s*(?:,|\/|or|and\/or|and)\s*(?:locally advanced|locally recurrent|advanced|unresectable|inoperable|incurable|recurrent)\b)*/gi, "metastatic"],
  [/\b(histologic(?:al)?ly|histopathologic(?:al)?ly|cytologic(?:al)?ly|pathologic(?:al)?ly)\s*(?:,\s*\w+\s*,?\s*)?(?:,?\s*(?:or|and\/or|and)\s*(?:histologic|histopathologic|cytologic|pathologic|radiographic|radiologic|clinical)\w*)+/gi, "$1"],
];
/** "STEP 1: REGISTRATION (SCREENING):", "REGISTRATION ELIGIBILITY CRITERIA (STEP 1)": the registration step of every participant, not a cohort. */
export const REGISTRATION_HEADER = /^\W*(?:step\s*\d+\s*[:\-]?\s*)?(?:registration|screening|pre-?registration|eligibility)\s*(?:\((?:screening|step\s*\d+)\))?\s*(?:eligibility\s*)?(?:criteria)?\s*(?:\(step\s*\d+\))?\s*:\s*/i;
export const TIME_WINDOW = /\bwithin\s+(?:the\s+)?(?:(?:last|past|previous|prior)\s+)?(?:\d+|one|two|three|four|five|six|eight|twelve)\b|\b(?:in|during)\s+the\s+(?:last|past|previous|prior)\s+(?:\d+|one|two|three|four|five|six|twelve)?\s*(?:days?|weeks?|months?|years?)\b|\b\d+\s*(?:days?|weeks?|months?|half-lives)\s+(?:prior|before|of|after|since)\b|\bwash-?out\b|\blast dose\b|(?:>=|\u2265|at least)\s*\d+\s*(?:days?|weeks?|months?)\b/i;

/** "or" forms that are not alternatives between criteria: number ranges, comparators, method pairs, sex pairs. */
export const BENIGN_OR = [
  /\b\d+(?:\.\d+)?\s*(?:,\s*\d+\s*,?\s*)?(?:or|and\/or)\s*\d+(?:\.\d+)?\b/gi,
  // Stage lists ("stage I or II", "stages IIIB/IIIC or IV") name a range of one attribute.
  /\bstages?\s*(?:0|i{1,3}|iv|[1-4])[a-c]?(?:\s*(?:,|\/|or|and\/or|and|-|–|to)\s*(?:stages?\s*)?(?:0|i{1,3}|iv|[1-4])[a-c]?\b)+/gi,
  /\b(?:equal to|greater than|less than|more than|fewer than|higher than|lower than|older|younger|above|below|at least)\s+(?:or|and\/or)\s+/gi,
  /\b(?:or|and\/or)\s+(?:equal|older|younger|greater|less|more|above|below|higher|lower|over|under)\b/gi,
  /\b(?:histologic(?:al)?ly|histopathologic(?:al)?ly|cytologic(?:al)?ly|pathologic(?:al)?ly|radiographic(?:al)?ly|radiologic(?:al)?ly|clinically)\s*(?:,\s*\w+\s*,?\s*)?(?:,?\s*(?:or|and\/or|and)\s*(?:histologic|histopathologic|cytologic|pathologic|radiographic|radiologic|clinical)\w*)+/gi,
  /\b(?:on|during|prior to|before|at)\s+or\s+(?:after|following|during|within|after)\b/gi,
  /\b(?:receiving|be receiving|is receiving|are receiving)\s+or\s+(?:plans?|planning|intend\w*|scheduled|about)\s+to\b/gi,
  /\b(?:male|men|female|women)\s+(?:or|and\/or)\s+(?:male|men|female|women)\b/gi,
  /\b(?:ECOG|Eastern Cooperative Oncology Group)\b[^.;]{0,40}?\b(?:or|and\/or)\b/gi,
  /\b(?:BRCA ?1|BRCA)\s*(?:or|and\/or|\/)\s*BRCA ?2\b/gi,
  /\b(?:IDH ?1)\s*(?:or|and\/or|\/)\s*IDH ?2\b/gi,
  /\b(?:ER|estrogen receptor)\s*(?:and\/or|or|\/)\s*(?:PR|progesterone receptor)\b/gi,
  // Hormone receptor status named by its two receptors with their results ("ER+ and/or PR+", "ER or PgR >= 1%").
  /\b(?:ER|estrogen receptor)(?:\s*\(ER\))?(?:\s*[-+]|\s*-?\s*(?:positive|negative|low))?(?:\s*[[(]ER[+-]?[\])])?(?:\s*[<>\u2264\u2265]=?\s*\d+\s*%)?\s*,?\s*(?:and\/or|or|\/)\s*(?:PR|PgR|progesterone receptor)\b/gi,
  // One HER2 score range ("IHC 0, 1+, or 2+", "IHC 1+ or 2+/ISH-negative").
  /\b(?:IHC\s*)?(?:score\s*(?:of\s*)?)?[0-3]\+?(?:\s*,\s*[0-3]\+?)*\s*,?\s*(?:or|and\/or)\s*(?:IHC\s*)?[0-3]\+/gi,
  // Specimen, disease-extent and test-method pairs describe how or where, not a second criterion.
  /\b(?:tissue|blood|plasma|serum|archival|fresh|liquid)\s+(?:biopsy\s+)?(?:or|and\/or)\s+(?:tissue|blood|plasma|serum|archival|fresh|liquid)\b/gi,
  /\b(?:locally advanced|locally recurrent|advanced|metastatic|unresectable|inoperable|incurable|recurrent|stage\s*(?:iv|4|iii|3)[a-c]?)\b(?:\s*(?:,|\/|or|and\/or|and)\s*(?:locally advanced|locally recurrent|advanced|metastatic|unresectable|inoperable|incurable|recurrent|stage\s*(?:iv|4|iii|3)[a-c]?)\b)+/gi,
  // Disease-status pairs ("relapsed or refractory"), histology-inclusive pairs ("squamous or non-squamous") and
  // testing-site pairs ("local or central") describe one state or one method, not two criteria.
  /\b(?:relapsed|relapsing|recurrent|refractory|progressive|progressed|persistent|resistant)\s*(?:\/|,|or|and\/or|and)\s*(?:relapsed|relapsing|recurrent|refractory|progressive|progressed|persistent|resistant)\b/gi,
  /\b(?:squamous|non-?squamous|nonsquamous)\s+(?:or|and\/or|and)\s+(?:squamous|non-?squamous|nonsquamous)\b/gi,
  /\b(?:local|central|locally|centrally)\s+(?:or|and\/or)\s+(?:local|central|locally|centrally)\b/gi,
  /\b(?:IHC|ISH|FISH|NGS|PCR)\s*(?:\/|or|and\/or)\s*(?:IHC|ISH|FISH|NGS|PCR)\b/gi,
  /\b(?:surgical resection|surgery|resection)\s+(?:or|and\/or)\s+(?:radiation(?: therapy)?|radiotherapy)\b/gi,
  // One excluding condition named two ways, or two infections both settled by one answer.
  /\b(?:pregnant|pregnancy)\s*(?:,\s*)?(?:or|and\/or|\/)\s*(?:(?:are|is)\s+)?(?:breast-?\s?feeding|lactating|nursing)\b/gi,
  /\b(?:hepatitis\s*B|HBV)\s*(?:,\s*)?(?:or|and\/or|\/)\s*(?:hepatitis\s*)?(?:C|HCV)\b/gi,
  /\b(?:FISH|IHC|NGS|PCR|ctDNA|cfDNA|CISH)\b[^.;]{0,60}?\b(?:or|and\/or)\s*(?:\(\d\)\s*)?(?:a |an |the )?(?:fluorescence|immuno\w*|next|tissue|circulating|cell-free|cfDNA|ctDNA|FISH|IHC|NGS|PCR|CISH|blood|plasma|polymerase|sequencing|in situ)/gi,
];
/**
 * Definitions and asides that are not criteria of their own: bracketed and parenthetical text ("(ER and/or PR >1%)"),
 * and sub-bullets that define a term ("HER2 negativity is defined as either of the following").
 */
export const DEFINITION_LINE = /^\s*[-*\u2022]\s+[^\n]*\b(?:defined as|is defined|are defined|will be defined|definition of|will be included|is considered|are considered)\b[^\n]*$/gim;
export function stripDefinitions(text: string): string {
  let t = text.replace(/\[[^\]]*\]/g, " ");
  for (let i = 0; i < 3; i++) t = t.replace(/\([^()]*\)/g, " ");
  return t.replace(DEFINITION_LINE, " ");
}

/** True when the item offers alternatives that a fact-by-fact check would misread. Exported for tests. */
export function hasAlternatives(text: string): boolean {
  let t = text;
  for (const re of BENIGN_OR) t = t.replace(re, " ");
  t = stripDefinitions(t);
  for (const re of BENIGN_OR) t = t.replace(re, " ");
  return /\b(?:or|and\/or|either|one of the following|any of the following|at least one of)\b/i.test(t);
}

/** Words that carry no criterion content of their own. */
export const FILLER = new Set(
  "a an the of to in on for with without by at as and is are be been being must should will have has had having patients patient participants participant subjects subject who which that this these those any all no not none known documented confirmed histologically cytologically pathologically diagnosis diagnosed evidence history prior previous previously current currently presence present status disease cancer carcinoma tumor tumors tumour malignancy defined per score level levels test tested testing result results positive negative mutation mutations mutated alteration alterations amplification amplified expression overexpression fusion rearrangement wild type wildtype germline somatic years year old age aged older younger or than equal greater less at least more over under between ecog performance eastern cooperative oncology group karnofsky kps lansky line lines regimen regimens therapy therapies treatment treatments treated untreated systemic received receiving newly brain cns central nervous system metastases metastasis metastatic leptomeningeal active stable symptomatic untreated measurable evaluable recist criteria lesion lesions according version male female men women other another second malignancies malignant cancers neoplasm neoplasms only also i ii iii iv ie eg e.g i.e advanced locally unresectable inoperable distant stage staged early localized localised non-metastatic nonmetastatic solid relapsed refractory recurrent progressed progression anti-cancer anticancer".split(" "),
);
export const TOKEN = /[A-Za-z][A-Za-z0-9-]*/g;

/**
 * Words that name a health-history fact. They count as explained only when that fact was checked, so
 * "adequate liver function" (a lab rule) is never read as settled by the organ answer.
 */
export const HISTORY_WORDS: Record<string, string> = {
  age: "adults both males females time signing form enrollment enrolment screening registration",
  hiv: "hiv human immunodeficiency virus infection infections seropositive seropositivity aids viral load detectable undetectable uncontrolled",
  hepatitis_b: "hepatitis hbv viral infection infections chronic hbsag",
  hepatitis_c: "hepatitis hcv viral infection infections chronic",
  organ_transplant: "organ solid transplant transplantation recipient recipients allograft",
  allo_sct: "allogeneic stem cell hematopoietic transplant transplantation hsct sct bone marrow",
  autoimmune: "autoimmune disease diseases disorder disorders",
  kidney_disease: "kidney renal disease dialysis failure",
  liver_disease: "liver hepatic disease cirrhosis failure",
  // Not "cardiac": the question asks about heart failure or a recent heart attack, not any cardiac disease.
  heart_disease: "heart disease failure congestive myocardial infarction",
  pregnancy: "pregnant pregnancy breastfeeding breast-feeding breast feeding lactating nursing women woman childbearing child-bearing potential reproductive females female",
  concurrent_trial: "concurrent concurrently enrolled enrollment participation participating another clinical trial trials study studies interventional investigational agent agents drug drugs product products",
  measurable_disease: "measurable target lesion lesions imaging radiographically radiographic response evaluation investigator investigators based per using defined determined applicable evidence presence baseline enrollment version least one",
  brain_mets: "carcinomatous meningitis lesions",
  other_malignancy: "primary additional concurrent synchronous invasive",
};

/** Content words the checked facts do not account for (marker names and the patient's cancer-type words excluded). */
export function residualWords(text: string, p: ResolverProfile, checkedKeys: readonly string[] = [], extra?: ReadonlySet<string>): string[] {
  const explained = new Set(checkedKeys.flatMap((k) => (HISTORY_WORDS[k] ?? "").split(" ").filter(Boolean)));
  if (extra) for (const w of extra) explained.add(w);
  let t = text;
  for (const b of BIOMARKERS) t = t.replace(new RegExp(b.pattern.source, `${b.pattern.flags.replace("g", "")}g`), " ");
  if (p.group) for (const re of groupTerms(p.group)) t = t.replace(new RegExp(re.source, `${re.flags.replace("g", "")}g`), " ");
  return (t.match(TOKEN) ?? []).map((w) => w.toLowerCase()).filter((w) => !FILLER.has(w) && !explained.has(w) && !/^\d/.test(w) && !/^v\d/.test(w) && w.length > 1);
}
/**
 * Qualifier words of an exclusion the patient does not meet at all ("active ... requiring treatment within the past 2 years"):
 * they only narrow the condition, so they need no answer of their own. Used only when the patient lacks the condition.
 */
export const EXCLUSION_QUALIFIERS = new Set(
  "within past last months month years weeks week days day prior before requiring required requires needs need treatment systemic therapy symptomatic uncontrolled severe significant clinically history known current currently ongoing evidence seropositive seropositivity positive testing test screening registration enrollment consent entry starting first dose study because due since cause may potential potentially dangerous effects fetus infant fetal teratogenic risk investigator opinion judgment active chronic any form type serious".split(" "),
);
/** Positive labels need the item to be about the checked facts: at most this many unexplained content words. */
export const MAX_RESIDUAL = 2;

/** A drug name (generic, brand or code) in the item: drug-specific criteria are not settled by our answers. */
export function mentionsDrug(text: string): boolean {
  const words = text.split(/[\s,;:()[\]{}"'/]+/).map((w) => w.replace(/^[.]+|[.]+$/g, "")).filter((w) => w.length >= 4);
  return words.some((w, i) => canonicalDrug(w) !== null || (i + 1 < words.length && canonicalDrug(`${w} ${words[i + 1]}`) !== null));
}

/** HGNC aliases of tracked markers rewritten to the symbol our extractor knows ("CD274" -> "PD-L1", "ERBB1" -> "EGFR"). */
export const MARKER_BY_GENE: Record<string, string> = { ERBB2: "HER2", CD274: "PD-L1", EGFR: "EGFR", ALK: "ALK", ROS1: "ROS1", KRAS: "KRAS", BRAF: "BRAF", NTRK1: "NTRK", FLT3: "FLT3", MET: "MET", RET: "RET", NPM1: "NPM1", TP53: "TP53", MGMT: "MGMT", PIK3CA: "PIK3CA", ESR1: "ESR1", PALB2: "PALB2", KIT: "KIT", CLDN18: "CLDN18" };
export function normalizeMarkers(text: string): string {
  return text.replace(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*\b/g, (w) => {
    if (w.length < 3 || w.length > 10) return w;
    if (BIOMARKERS.some((b) => b.pattern.test(w))) return w;
    const sym = canonicalGene(w);
    const marker = sym ? MARKER_BY_GENE[sym] : undefined;
    return marker && marker !== w ? marker : w;
  });
}

export const UNTREATED_NON_CANCER = /\buntreated\s+(?:\w+\s+){0,2}(?:brain|cns|metasta\w*|lesions?|infections?|spinal|cord compression|leptomeningeal|hypertension|thyroid|disease of)\b/i;
export const CARVE_OUT = /\b(?:unless|except|other than|with the exception of|permitted|allowed|acceptable|may (?:be|have)|eligible if|are eligible)\b/i;
export const SUBGROUP_RULE = /\b[A-Za-z0-9/-]*[A-Za-z0-9][+-]\s+(?:patients?|participants?|subjects?|women|men|tumou?rs?|disease)\s+(?:must|should|need|are required|will need|have to)\b|\b(?:patients?|participants?|subjects?)\s+(?:with|who (?:are|have))\s+[^.;,]{1,80}?\s+(?:must|should|need to|will need to|are required to)\b|^\W*(?:for|in)\s+(?:(?:patients?|participants?|subjects?|those)\s+)?(?:with\s+)?[^,;:]{1,60},\s/i;
/** "Patients in Phase 2b with ...": a cohort named mid-sentence. */
export const PHASE_COHORT = /\b(?:in|for|of|during)\s+(?:the\s+)?phase\s*(?:1|2|3|i{1,3})[ab]?\b(?!\s*(?:trial|study|clinical))/i;
/** Inclusion wording that says who MAY join, not who must. */
export const PERMISSIVE_ITEM = /\b(?:allowed|permitted|acceptable|may (?:be|have|enroll|participate)|eligible if|are (?:also )?eligible|will (?:also )?be (?:equally )?considered|can be enrolled)\b/i;
export const MSI_NEG = /\b(?:non-?|not\s+)(?:MSI-?H(?:igh)?|dMMR)\b|\bMSS\b|\bmicrosatellite[- ]stab(?:le|ility)\b|\bpMMR\b|\bmismatch[- ]repair[- ]proficien\w*|\bproficient\s+mismatch[- ]repair\b|\bMMR[- ]proficien\w*|\bMSI-?L(?:ow)?\b/gi;
export const MSI_POS = /\bMSI-?H(?:igh)?\b|\bmicrosatellite[- ]instability[- ]high\b|\bhigh(?:[- ]level)?\s+microsatellite[- ]instability\b|\bdMMR\b|\bmismatch[- ]repair[- ]deficien\w*|\bdeficient\s+mismatch[- ]repair\b|\bMMR[- ]deficien\w*/i;
/** "required" / "excluded" for biomarker:MSI-H from MSI status words; null when absent, mixed, optional or qualified. */
export function msiDirection(section: "inclusion" | "exclusion", text: string): "required" | "excluded" | null {
  const neg = MSI_NEG.test(text);
  MSI_NEG.lastIndex = 0;
  const pos = MSI_POS.test(text.replace(MSI_NEG, " "));
  if (pos === neg) return null; // neither, or both ("MSI-H or MSS", "regardless of MSI-H/MSS status")
  if (/\b(?:regardless|irrespective|independent of|any MSI|status (?:is )?(?:unknown|pending)|either|unless|except|other than)\b/i.test(text) || hasAlternatives(text.replace(/\bMSI-?H(?:igh)?\s*(?:\/|or|and\/or)\s*dMMR\b|\bdMMR\s*(?:\/|or|and\/or)\s*MSI-?H(?:igh)?\b|\bMSS\s*(?:\/|or|and\/or)\s*pMMR\b|\bpMMR\s*(?:\/|or|and\/or)\s*MSS\b/gi, "MSI"))) return null;
  // inclusion: positive state required / negative state means positive patients are excluded; exclusion flips.
  if (section === "inclusion") return pos ? "required" : "excluded";
  return pos ? "excluded" : "required";
}
