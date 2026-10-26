/**
 * Criterion items the study team checks at screening, which no questionnaire answer can settle: consent and
 * visit logistics, lab and heart-test values, contraception agreements, tissue samples and life expectancy.
 * They stay "unknown" for scoring (display only), are grouped apart in the checklist instead of counting as an open
 * question for the patient, and are not sent to the criterion judge (it would answer "unknown" for them anyway).
 * An item that also names a patient fact (a disease, treatment, biomarker...) is never screening-only. Word lists
 * only (no fact extractor): this runs on the trial page, whose JS budget is tight.
 */
import { BIOMARKERS } from "@/config/biomarkers";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";

const CONSENT =
  /\binformed consent\b|\bconsent form\b|\bsign(?:ed|s)?\s+(?:the\s+)?(?:a\s+)?(?:written\s+)?(?:informed\s+)?consent\b|\bwilling(?:ness)?\s+(?:and\s+able\s+)?to\s+(?:comply|sign|return|participate|follow|attend|adhere|complete)\b|\bable\s+to\s+comply\b|\bcomply\s+with\s+(?:the\s+)?(?:study|protocol|all)\b|\b(?:study|protocol)[- ](?:visits|procedures|requirements|schedule)\b|\bfollow-?up\s+(?:visits|schedule|assessments)\b|\bgeographic(?:al)?(?:ly)?\s+(?:proximity|accessible|close)\b|\blife expectancy\b/i;
const LABS =
  /\b(?:ANC|absolute neutrophil count|neutrophils?|platelets?|hemoglobin|haemoglobin|creatinine|creatinine clearance|eGFR|GFR|bilirubin|AST|ALT|SGOT|SGPT|transaminases?|ULN|upper limit of normal|INR|aPTT|PTT|prothrombin|albumin|leukocytes?|WBC|lipase|amylase|QTc?F?|LVEF|ejection fraction|echocardiogram|MUGA|ECG|EKG|electrocardiogram)\b|\badequate\s+(?:organ|bone marrow|hematologic(?:al)?|haematologic(?:al)?|renal|hepatic|liver|kidney|cardiac|end[- ]organ)\s+(?:and\s+\w+\s+)?function\b|\b(?:laboratory|lab)\s+(?:values?|parameters?|tests?)\b/i;
const CONTRACEPTION = /\bcontracepti\w*|\bbirth control\b|\babstinen\w*|\bcondoms?\b|\bsterili[sz]\w*\b|\bchildbearing potential\b.*\b(?:agree|use|must)\b/i;
const TISSUE = /\barchival\s+(?:tumou?r\s+)?(?:tissue|specimens?|samples?|blocks?)\b|\btumou?r\s+(?:tissue\s+)?(?:samples?|blocks?|specimens?)\b|\btissue\s+(?:samples?|specimens?|blocks?)\b|\bwilling\s+to\s+(?:undergo|provide)\s+(?:a\s+)?(?:fresh\s+|new\s+|mandatory\s+)?(?:tumou?r\s+)?biops/i;

/**
 * Wording a patient can answer about: age, a named condition ("kidney disease [eGFR < 30]", "atrial fibrillation"),
 * treatment history ("prior chemotherapy with ANC recovery") or performance status.
 */
const PATIENT_WORDS =
  /\b(?:age[ds]?|years? (?:of age|old))\b|\b(?:disease|failure|cirrhosis|dialysis|fibrillation|infarction|angina|stroke|hepatitis|HIV|infection|transplant\w*|metasta\w*|cancer|carcinoma|tumou?r|lymphoma|leuk[a]?emia|myeloma|anemia|anaemia|syndrome|disorder)\b|\b(?:chemo\w*|radiation|radiotherapy|surg\w*|resect\w*|immunotherap\w*|inhibitors?|prior (?:therapy|treatment|systemic)|previously treated|ECOG|Karnofsky|performance status|brain)\b/i;

/** Is this item checked by the study team at screening rather than by the patient's answers? */
export function isScreeningItem(item: Pick<SplitCriterion, "section" | "text">): boolean {
  const t = item.text;
  if (!(CONSENT.test(t) || LABS.test(t) || CONTRACEPTION.test(t) || TISSUE.test(t))) return false;
  // Tissue-sample items name the tumor by nature; every other kind must not name anything the patient could answer.
  if (PATIENT_WORDS.test(TISSUE.test(t) ? t.replace(/\btumou?r\b|\bcancer\b|\bcarcinoma\b/gi, " ") : t)) return false;
  // Labs or consent next to a biomarker ("PD-L1 TPS", "HER2 ... LVEF") is not screening-only.
  return !BIOMARKERS.some((b) => b.pattern.test(t));
}
