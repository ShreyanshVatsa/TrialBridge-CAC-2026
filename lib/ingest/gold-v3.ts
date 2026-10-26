/**
 * Gold v3 (eval/gold/gold-v3.json): trial-level labels in our own fact-key space, written by blind labelers from the
 * criteria text alone (guidelines: eval/gold/gold-v3-guidelines.md). Not clinician-reviewed.
 *
 * Judging rule ("conflict-safe precision"), fixed before any v3 label was read: a directional fact we commit is
 * CORRECT when every conflict it can raise is justified by the gold label of the same key (or an implied one):
 *  - same direction;
 *  - excluded: our scope is no broader than gold's (any < years < active; a window fact only matches a window or any
 *    exclusion; an organ-disease exclusion matches any gold exclusion of that organ);
 *  - numeric params no stricter than gold (ECOG ceiling >= gold, min lines <= gold, max lines >= gold, other-cancer
 *    window <= gold).
 * Everything else (gold silent, conditional, other direction, broader scope, stricter number) is INCORRECT.
 * "mentioned" facts are never judged (they never penalize).
 */
import { isScopedParam, type FactParam, type FactValue } from "@/lib/types/trial";

export type GoldV3Value = "required" | "excluded" | "conditional";
export type GoldV3Scope = "any" | "window" | "active" | "years" | "limited";

export interface GoldV3Label {
  key: string;
  value: GoldV3Value;
  scope?: GoldV3Scope | null;
  param?: string | number | null;
  quote: string;
  ref?: string;
  note?: string;
}
export interface GoldV3Trial {
  trial_id: string;
  split: "dev" | "held";
  stratum: string;
  labels: GoldV3Label[];
}
export interface OurFact {
  key: string;
  value: FactValue;
  param?: FactParam;
}

/** Scoped exclusions (washout windows, limited scope) never penalize, so they are not judged. */
export const isWindowParam = (p: FactParam | undefined): boolean => isScopedParam(p);

const ORGAN_KEYS = new Set(["heart_disease", "kidney_disease", "liver_disease"]);
const CHEMO_CLASSES = ["platinum", "taxane", "fluoropyrimidine", "temozolomide"];
const IO_CLASSES = ["checkpoint", "car_t", "bispecific"];
const TARGETED_CLASSES = ["anti_her2", "adc", "egfr_tki", "alk_tki", "parp", "braf_mek", "anti_vegf", "vegf_tki", "cdk46", "btk", "venetoclax"];

const num = (p: GoldV3Label["param"]): number => (typeof p === "number" ? p : Number(/\d+/.exec(String(p ?? ""))?.[0] ?? NaN));

/** Gold rows for a key, plus rows implied by other keys (labelers are told to label both sides, but often label one). */
export function goldRowsFor(key: string, labels: readonly GoldV3Label[]): GoldV3Label[] {
  const own = labels.filter((l) => l.key === key);
  const at = (k: string) => labels.filter((l) => l.key === k);
  const req = (k: string) => at(k).filter((l) => l.value === "required");
  const exAny = (k: string) => at(k).filter((l) => l.value === "excluded" && (l.scope ?? "any") === "any");
  const implied: GoldV3Label[] = [];
  const as = (rows: GoldV3Label[], value: GoldV3Value, extra: Partial<GoldV3Label> = {}) => rows.forEach((r) => implied.push({ ...r, key, value, ...extra }));
  switch (key) {
    case "previously_treated":
      as(req("recurrent"), "required");
      as(req("min_prior_lines").filter((r) => num(r.param) >= 1), "required");
      for (const k of ["prior_chemotherapy", "prior_immunotherapy", "prior_targeted_therapy"]) as(req(k), "required");
      as(req("newly_diagnosed"), "excluded", { scope: "any" });
      as(at("max_prior_lines").filter((r) => r.value === "required" && num(r.param) === 0), "excluded", { scope: "any" });
      break;
    case "newly_diagnosed":
      as(exAny("previously_treated"), "required");
      as(at("max_prior_lines").filter((r) => r.value === "required" && num(r.param) === 0), "required");
      break;
    case "min_prior_lines":
      as(req("previously_treated"), "required", { param: 1 });
      as(req("recurrent"), "required", { param: 1 });
      break;
    case "max_prior_lines":
      as(req("newly_diagnosed"), "required", { param: 0 });
      as(exAny("previously_treated"), "required", { param: 0 });
      break;
    case "prior_chemotherapy":
      for (const c of CHEMO_CLASSES) as(req(`prior_drug:${c}`), "required");
      as(exAny("previously_treated"), "excluded", { scope: "any" });
      break;
    case "prior_immunotherapy":
      for (const c of IO_CLASSES) as(req(`prior_drug:${c}`), "required");
      as(exAny("previously_treated"), "excluded", { scope: "any" });
      break;
    case "prior_targeted_therapy":
      for (const c of TARGETED_CLASSES) as(req(`prior_drug:${c}`), "required");
      as(exAny("previously_treated"), "excluded", { scope: "any" });
      break;
    case "recurrent":
      as(req("newly_diagnosed"), "excluded", { scope: "any" });
      break;
    default:
      if (key.startsWith("prior_drug:")) as(exAny("previously_treated"), "excluded", { scope: "any" });
  }
  // An explicit conditional label of the key itself wins over implied rows.
  if (own.some((r) => r.value === "conditional")) return own;
  return [...own, ...implied];
}

/** Our excluded-fact scope. */
function ourScope(f: OurFact): "any" | "years" | "active" | "window" {
  if (f.param === undefined) return "any";
  if (typeof f.param === "number") return "years";
  if (isWindowParam(f.param)) return "window";
  return "active";
}

function rowMatches(f: OurFact, r: GoldV3Label): boolean {
  if (r.value !== f.value) return false;
  if (f.value === "required") {
    const g = num(r.param);
    const p = typeof f.param === "number" ? f.param : NaN;
    if (f.key === "ecog_max") return !Number.isNaN(g) && p >= g;
    if (f.key === "min_prior_lines") return !Number.isNaN(g) && p <= g;
    if (f.key === "max_prior_lines") return !Number.isNaN(g) && p >= g;
    return true;
  }
  // excluded
  if (ORGAN_KEYS.has(f.key)) return true;
  const gs = (r.scope ?? "any") as GoldV3Scope;
  const ours = ourScope(f);
  switch (ours) {
    case "any":
      return gs === "any";
    case "years": {
      if (gs === "any") return true;
      return gs === "years" && num(r.param) >= (f.param as number);
    }
    case "active":
      return gs === "any" || gs === "active" || gs === "years";
    case "window":
      return gs === "window" || gs === "any";
  }
}

/** Judge one directional fact against a trial's gold labels. */
export function judgeV3(f: OurFact, labels: readonly GoldV3Label[]): boolean {
  if (f.value === "mentioned") throw new Error("mentioned facts are not judged");
  const rows = goldRowsFor(f.key, labels);
  if (rows.some((r) => r.value === "conditional")) return false;
  return rows.some((r) => rowMatches(f, r));
}

/** Gold rows that a perfect extractor would turn into a penalizing fact (for recall): directional, whole-trial, not "limited". */
export function goldDirectional(labels: readonly GoldV3Label[]): GoldV3Label[] {
  return labels.filter((l) => (l.value === "required" || l.value === "excluded") && l.scope !== "limited");
}
