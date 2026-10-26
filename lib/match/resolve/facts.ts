/** Fact verdicts: one extracted fact against the profile. Part of the criterion resolver (./index.ts). */
import type { BiomarkerId } from "@/config/biomarkers";
import { isScopedParam, type FactParam, type FactValue } from "@/lib/types/trial";
import type { Range, ResolverProfile } from "./profile";

/** ok = the patient fits this fact; fail = the fact rules the patient out; open = the answers can't tell. */
export type Verdict = "ok" | "fail" | "open";
export interface Checked {
  key: string;
  verdict: Verdict;
  questions: readonly string[];
}

/**
 * Health-history fact keys, settled from the deep-dive answers, on exclusion items only: inclusion items naming
 * them are conditional ("HIV-infected participants must have controlled HIV", "the donor must be HIV negative").
 * "metastatic" is not here: the rule extractor also fires on brain-metastasis and radiosurgery wording.
 */
export const HISTORY_KEYS = ["hiv", "hepatitis_b", "hepatitis_c", "organ_transplant", "allo_sct", "autoimmune", "kidney_disease", "liver_disease", "heart_disease", "pregnancy", "concurrent_trial"] as const;
export const isHistoryKey = (k: string) => (HISTORY_KEYS as readonly string[]).includes(k);
/** Fact keys the resolver may settle (docs/dev/QUESTIONNAIRE_SPEC.md §3, plus the health-history keys). */
export const ALLOWED_KEYS = new Set<string>(["ecog_max", "min_prior_lines", "max_prior_lines", "previously_treated", "newly_diagnosed", "brain_mets", "measurable_disease", "other_malignancy", ...HISTORY_KEYS]);
export const allowedKey = (k: string) => ALLOWED_KEYS.has(k) || k.startsWith("biomarker:") || k.startsWith("histology:");

/** Does the patient HAVE the attribute? true / false / undefined (unknown). */
export function hasAttr(key: string, p: ResolverProfile): boolean | undefined {
  const organ = (o: "kidney" | "liver" | "heart") => (p.organs ? p.organs.has(o) : undefined);
  switch (key) {
    case "hiv":
      return p.hiv === undefined ? undefined : p.hiv !== "no";
    // A single-choice answer names one infection; it says nothing about the other one.
    case "hepatitis_b":
      return p.hepatitis === undefined ? undefined : p.hepatitis === "hep_b" ? true : p.hepatitis === "no" ? false : undefined;
    case "hepatitis_c":
      return p.hepatitis === undefined ? undefined : p.hepatitis === "hep_c" ? true : p.hepatitis === "no" ? false : undefined;
    case "organ_transplant":
      return p.transplant === undefined ? undefined : p.transplant === "organ";
    case "allo_sct":
      return p.transplant === undefined ? undefined : p.transplant === "allo";
    case "autoimmune":
      return p.autoimmune === undefined ? undefined : p.autoimmune !== "no";
    case "kidney_disease":
      return organ("kidney");
    case "liver_disease":
      return organ("liver");
    case "heart_disease":
      return organ("heart");
    case "pregnancy":
      return p.pregnant;
    case "concurrent_trial":
      return p.inOtherTrial;
  }
  if (key === "previously_treated") return p.treated;
  if (key === "newly_diagnosed") return p.treated === undefined ? undefined : !p.treated;
  if (key === "measurable_disease") return p.measurable;
  if (key.startsWith("biomarker:")) {
    const s = p.biomarkers?.[key.slice("biomarker:".length) as BiomarkerId];
    return s === undefined ? undefined : s === "positive";
  }
  if (key.startsWith("histology:")) {
    const h = key.slice("histology:".length);
    if (p.histologyIs?.has(h)) return true;
    if (p.histologyIsNot?.has(h)) return false;
    return undefined;
  }
  return undefined;
}

export const fromBool = (has: boolean | undefined, value: FactValue): Verdict => (has === undefined ? "open" : (value === "required") === has ? "ok" : "fail");
export const inRange = (r: Range | undefined, ok: (lo: number, hi: number) => boolean | undefined): Verdict => {
  if (!r) return "open";
  const v = ok(r[0], r[1]);
  return v === undefined ? "open" : v ? "ok" : "fail";
};

/** Verdict of one extracted fact against the profile. Scoped (time-window) params are always open. */
export function checkFact(f: { key: string; value: FactValue; param?: FactParam }, p: ResolverProfile): Verdict {
  if (f.value === "mentioned" || isScopedParam(f.param)) return "open";
  const n = typeof f.param === "number" ? f.param : undefined;
  switch (f.key) {
    case "ecog_max":
      if (f.value !== "required" || n === undefined) return "open";
      return inRange(p.ecog, (lo, hi) => (hi <= n ? true : lo > n ? false : undefined));
    case "min_prior_lines":
      if (f.value !== "required" || n === undefined) return "open";
      return inRange(p.lines, (lo, hi) => (lo >= n ? true : hi < n ? false : undefined));
    case "max_prior_lines":
      if (f.value !== "required" || n === undefined) return "open";
      return inRange(p.lines, (lo, hi) => (hi <= n ? true : lo > n ? false : undefined));
    case "brain_mets": {
      const b = p.brainMets;
      if (!b) return "open";
      if (f.value === "required") return b === "none" ? "fail" : "ok";
      if (f.param === "active_only") return b === "active" ? "fail" : "ok";
      return f.param === undefined ? (b === "none" ? "ok" : "fail") : "open";
    }
    case "other_malignancy": {
      const o = p.otherCancer;
      if (!o || f.value !== "excluded") return "open";
      if (o === "no") return "ok";
      if (f.param === undefined) return "fail";
      if (f.param === "active_only") return o === "over_2y" ? "ok" : "open";
      if (n === undefined) return "open";
      // "over_2y" = treated more than 2 years ago; "recent" = within the last 2 years.
      if (o === "over_2y") return n <= 2 ? "ok" : "open";
      return n >= 2 ? "fail" : "open";
    }
    // Carve-outs the answers settle (catalog effects in config/questionnaire/common.ts use the same params).
    case "hiv":
      if (f.value === "excluded" && f.param === "uncontrolled_only") return p.hiv === undefined ? "open" : p.hiv === "other" ? "fail" : "ok";
      return f.param === undefined ? fromBool(hasAttr(f.key, p), f.value) : "open";
    case "hepatitis_b":
    case "hepatitis_c":
      // "Active hepatitis only": the answer does not say whether the infection is active.
      if (f.param === "active_only") return hasAttr(f.key, p) === false ? "ok" : "open";
      return f.param === undefined ? fromBool(hasAttr(f.key, p), f.value) : "open";
    case "autoimmune":
      if (f.value === "excluded" && f.param === "active_only") return p.autoimmune === undefined ? "open" : p.autoimmune === "yes_active" ? "fail" : "ok";
      return f.param === undefined ? fromBool(hasAttr(f.key, p), f.value) : "open";
    default:
      if (!allowedKey(f.key)) return "open";
      // A carve-out param the answers do not model ("controlled", "within 5 years", ...) keeps a history fact open.
      if (f.param !== undefined && isHistoryKey(f.key)) return "open";
      return fromBool(hasAttr(f.key, p), f.value);
  }
}

export const SOURCE_FIELD: Record<string, string> = {
  ecog_max: "ecog",
  min_prior_lines: "lines",
  max_prior_lines: "lines",
  previously_treated: "treated",
  newly_diagnosed: "treated",
  brain_mets: "brainMets",
  measurable_disease: "measurable",
  other_malignancy: "otherCancer",
  hiv: "hiv",
  hepatitis_b: "hepatitis",
  hepatitis_c: "hepatitis",
  organ_transplant: "transplant",
  allo_sct: "transplant",
  autoimmune: "autoimmune",
  kidney_disease: "organs",
  liver_disease: "organs",
  heart_disease: "organs",
  pregnancy: "pregnant",
  concurrent_trial: "inOtherTrial",
};
export const sourcesOf = (key: string, p: ResolverProfile): readonly string[] => p.sources[key.startsWith("histology:") ? "histology" : (SOURCE_FIELD[key] ?? key)] ?? [];
