/**
 * Scoring our committed facts against the blind gold set (eval/gold/gold-v1.json, schema in eval/gold/README.md).
 * The gold labels are provisional (not clinicians) and were written from the criteria text alone. These rules were
 * fixed BEFORE the gold labels were read and are applied once; they are not tuned against the gold set.
 *
 * A committed fact (directional, not needsReview) is:
 *  - "correct" when a gold row of the mapped family, applying to every participant (no `applies_to`), states the
 *    same direction AND the same parameter (line count, other-cancer window, active-only carve-out, drug class,
 *    marker, histology, setting);
 *  - "ambiguous" (left out of precision) when the gold family has only `ambiguous` rows;
 *  - "incorrect" otherwise (not stated, other direction, other parameter, or cohort-only rows).
 */
import { BIOMARKERS } from "@/config/biomarkers";
import { DRUG_CLASS_PATTERNS, HISTOLOGY_PATTERNS } from "@/config/criteria";
import type { DrugClassId } from "@/config/questionnaire/ids";
import type { FactParam, FactValue } from "@/lib/types/trial";

export interface GoldLabel {
  family: string;
  value: string;
  param?: string | number | null;
  quote?: string | null;
  scope?: string | null;
  applies_to?: string | null;
  confidence?: string | null;
  note?: string | null;
}
export interface GoldTrial {
  trial_id: string;
  group: string;
  title?: string;
  labels: GoldLabel[];
}
interface ScoredFact {
  key: string;
  value: FactValue;
  param?: FactParam;
}
export type Verdict = "correct" | "incorrect" | "ambiguous";

/** Our fact family (FACT_FAMILIES) -> gold family. */
export const GOLD_FAMILY: Readonly<Record<string, string>> = {
  lines: "lines_of_therapy",
  prior_drug: "prior_drugs",
  stage: "stage",
  recurrent: "relapsed_refractory",
  other_malignancy: "other_cancer",
  hepatitis: "hepatitis",
  biomarker_v2: "biomarkers",
  histology: "histology",
};

const txt = (l: GoldLabel) => `${l.param ?? ""} ${l.quote ?? ""}`;
const all = (l: GoldLabel) => !l.applies_to || !String(l.applies_to).trim();
const NEG = /\b(negative|wild[- ]?type|unmethylated|absence|absent|without|non-?)\b|-(?=\s|$|,|\))/i;

/** Line range "a-b" (or a number) -> {min,max}. */
function lineRange(p: GoldLabel["param"]): { min?: number; max?: number } {
  if (typeof p === "number") return { min: p };
  const m = /(\d+)\s*[-–to]+\s*(\d+)/.exec(String(p ?? ""));
  return m ? { min: Number(m[1]), max: Number(m[2]) } : {};
}
const num = (p: GoldLabel["param"]) => (typeof p === "number" ? p : Number(/\d+/.exec(String(p ?? ""))?.[0] ?? NaN));

function linesOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  const n = f.param;
  if (typeof n !== "number") return false;
  return rows.some((r) => {
    if (f.key === "min_prior_lines") return (r.value === "min_lines" && num(r.param) === n) || (r.value === "line_range" && lineRange(r.param).min === n) || (n === 0 && (r.value === "treatment_naive" || r.value === "first_line"));
    return (r.value === "max_lines" && num(r.param) === n) || (r.value === "line_range" && lineRange(r.param).max === n) || (n === 0 && (r.value === "treatment_naive" || r.value === "first_line"));
  });
}

const CLASS_WORD = /\b(inhibitors?|therap(y|ies)|agents?|antibod\w*|class|based|containing|chemotherap\w*|blockade|conjugates?|TKIs?|regimens?|directed|targeted|any|drugs?)\b/i;
function drugOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  const re = DRUG_CLASS_PATTERNS[f.key.slice(11) as DrugClassId];
  if (!re) return false;
  return rows.some((r) => {
    if (r.value !== f.value || !re.test(String(r.param ?? "")) && !re.test(String(r.quote ?? ""))) return false;
    if (f.value === "excluded") {
      const scope = String(r.scope ?? "any_history");
      // A washout or "currently taking" row is not an any-history exclusion; a single named agent is not the class.
      return scope === "any_history" && CLASS_WORD.test(String(r.param ?? ""));
    }
    return String(r.scope ?? "any_history") !== "current";
  });
}

const LA = /\blocally[- ]?advanced\b|\blocoregional(ly)? advanced\b/i;
const METS = /\bmetasta|\bstage\s*(iv|4)\b/i;
const ADJ = /\badjuvant\b|\bresected\b|\bno (radiographic |clinical )?evidence of disease\b|\bNED\b|\bpost-?operative\b|\bcomplete(ly)? (surgical )?resect/i;
function stageOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  return rows.some((r) => {
    if (r.value !== f.value) return false;
    const p = String(r.param ?? "");
    if (f.key === "locally_advanced") return LA.test(p) && (f.value === "excluded" || !METS.test(p));
    return ADJ.test(p.replace(/\bneo-?adjuvant\b/gi, "")) && (f.value === "excluded" || !METS.test(p));
  });
}

function otherCancerOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  return rows.some((r) => {
    if (r.value !== "excluded" || f.value !== "excluded") return false;
    const scope = String(r.scope ?? "any_history");
    if (f.param === undefined) return scope === "any_history";
    if (f.param === "active_only") return scope === "active_only";
    const m = /within_(\d+)_years?/.exec(scope);
    return !!m && Number(m[1]) === f.param;
  });
}

const HB = /\b(hepatitis B|HBV|HBsAg|hep(atitis)? B\b|hepatitis B (or|and|\/) C)/i;
const HC = /\b(hepatitis C|HCV|hep(atitis)? C\b|hepatitis B (or|and|\/|and\/or) C|B\/C)\b/i;
function hepOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  const re = f.key === "hepatitis_b" ? HB : HC;
  return rows.some((r) => {
    if (!re.test(txt(r))) return false;
    if (f.value === "required") return r.value === "required";
    if (f.value !== "excluded") return false;
    if (f.param === "active_only") return r.value === "allowed_if_controlled" || (r.value === "excluded" && r.scope === "active_only");
    return r.value === "excluded" && r.scope !== "active_only";
  });
}

function markerOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  const b = BIOMARKERS.find((x) => x.id === f.key.slice(10));
  if (!b) return false;
  return rows.some((r) => {
    if (r.value !== "required" && r.value !== "excluded") return false;
    if (!b.pattern.test(String(r.param ?? "")) && !b.pattern.test(String(r.quote ?? ""))) return false;
    // "required: Ph-negative" means Ph-positive patients are excluded.
    const flipped = NEG.test(String(r.param ?? ""));
    const dir = flipped ? (r.value === "required" ? "excluded" : "required") : r.value;
    return dir === f.value;
  });
}

function histologyOk(f: ScoredFact, rows: GoldLabel[]): boolean {
  const h = HISTOLOGY_PATTERNS.find((x) => x.id === f.key.slice(10));
  if (!h) return false;
  return rows.some((r) => {
    if (r.value !== "required" && r.value !== "excluded") return false;
    const p = String(r.param ?? "");
    const q = `${p} ${r.quote ?? ""}`;
    const neg = h.negated?.test(p) ?? false;
    const pos = h.re.test(p) || (!p && h.re.test(q));
    if (!neg && !pos) return false;
    const dir = neg ? (r.value === "required" ? "excluded" : "required") : r.value;
    if (dir !== f.value) return false;
    // "required: NSCLC or SCLC" is a list of eligible types, not "only this one".
    if (f.value === "required") {
      const others = HISTOLOGY_PATTERNS.filter((x) => x.id !== h.id && x.groups.some((g) => h.groups.includes(g)) && x.re.test(p) && !(h.id === "nsclc" && x.id === "lung_squamous") && !(h.id === "lung_squamous" && x.id === "nsclc"));
      if (others.length > 0) return false;
    }
    return true;
  });
}

const CHECK: Readonly<Record<string, (f: ScoredFact, rows: GoldLabel[]) => boolean>> = {
  lines: linesOk,
  prior_drug: drugOk,
  stage: stageOk,
  recurrent: (f, rows) => rows.some((r) => r.value === f.value),
  other_malignancy: otherCancerOk,
  hepatitis: hepOk,
  biomarker_v2: markerOk,
  histology: histologyOk,
};

/** Judge one committed fact of `family` (our family id) against a trial's gold rows. */
export function judge(family: string, f: ScoredFact, labels: readonly GoldLabel[]): Verdict {
  const gf = GOLD_FAMILY[family];
  const check = CHECK[family];
  if (!gf || !check) throw new Error(`No gold mapping for ${family}`);
  const rows = labels.filter((l) => l.family === gf);
  const directional = rows.filter((r) => r.value !== "ambiguous" && r.value !== "not_stated");
  if (directional.length === 0 && rows.some((r) => r.value === "ambiguous")) return "ambiguous";
  return check(f, directional.filter(all)) ? "correct" : "incorrect";
}

/** Gold rows of a family that our keys can express (for coverage): directional, whole-trial, mappable. */
export function relevantGold(family: string, labels: readonly GoldLabel[]): boolean {
  const gf = GOLD_FAMILY[family];
  const rows = labels.filter((l) => l.family === gf && all(l) && l.value !== "ambiguous" && l.value !== "not_stated" && l.value !== "allowed");
  switch (family) {
    case "lines":
      return rows.some((r) => ["min_lines", "max_lines", "line_range", "treatment_naive", "first_line"].includes(r.value));
    case "prior_drug":
      return rows.some((r) => (r.value === "required" || r.value === "excluded") && Object.values(DRUG_CLASS_PATTERNS).some((re) => re.test(String(r.param ?? ""))));
    case "stage":
      return rows.some((r) => (r.value === "required" || r.value === "excluded") && (LA.test(String(r.param ?? "")) || ADJ.test(String(r.param ?? ""))));
    case "biomarker_v2":
      return rows.some((r) => BIOMARKERS.some((b) => ["MET", "RET", "HPV", "CLDN18", "PH", "NPM1", "TP53", "MGMT", "PIK3CA", "ESR1", "PALB2", "KIT"].includes(b.id) && b.pattern.test(String(r.param ?? ""))));
    case "histology":
      return rows.some((r) => (r.value === "required" || r.value === "excluded") && HISTOLOGY_PATTERNS.some((h) => h.re.test(String(r.param ?? "")) || !!h.negated?.test(String(r.param ?? ""))));
    default:
      return rows.length > 0;
  }
}
