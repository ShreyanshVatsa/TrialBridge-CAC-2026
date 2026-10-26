/**
 * One precision gate for every penalizing fact key .
 *
 * Catalog families come from FACT_FAMILIES (eligibility-facts.ts). The legacy keys (metastatic, prior treatments,
 * treatment status, pregnancy, concurrent trial, the first biomarkers) used to penalize unconditionally; they are grouped
 * here into families of their own so the same gate and the same reliability weighting apply to them.
 *
 * A family may penalize only when its measured precision on held-out gold has n >= GATE_MIN_N judged directional
 * facts, a point estimate >= GATE_POINT and a 95% Wilson lower bound >= GATE_LB. Pure; no I/O.
 */
import { familyOf, type FactFamily } from "./eligibility-facts";

/** Legacy keys grouped into gate families. */
export const LEGACY_FAMILIES = {
  metastatic: ["metastatic"],
  prior_chemo: ["prior_chemotherapy"],
  prior_radiation: ["prior_radiation"],
  prior_surgery: ["prior_surgery"],
  prior_immunotherapy: ["prior_immunotherapy"],
  prior_targeted: ["prior_targeted_therapy"],
  treatment_status: ["newly_diagnosed", "previously_treated"],
  pregnancy: ["pregnancy"],
  concurrent_trial: ["concurrent_trial"],
  biomarker_v1: ["biomarker:HER2", "biomarker:HR", "biomarker:BRCA", "biomarker:EGFR", "biomarker:ALK", "biomarker:ROS1", "biomarker:KRAS", "biomarker:BRAF", "biomarker:PD-L1", "biomarker:MSI-H", "biomarker:NTRK", "biomarker:FLT3", "biomarker:IDH"],
} as const satisfies Record<string, readonly string[]>;
export type LegacyFamily = keyof typeof LEGACY_FAMILIES;
export type GateFamily = FactFamily | LegacyFamily;

/** Gate thresholds. */
export const GATE_MIN_N = 60;
export const GATE_POINT = 0.85;
export const GATE_LB = 0.8;

/** The gate family of any fact key (catalog family first, then the legacy groups), or null for keys no family covers. */
export function gateFamilyOf(key: string): GateFamily | null {
  const v2 = familyOf(key);
  if (v2) return v2;
  for (const [fam, keys] of Object.entries(LEGACY_FAMILIES) as [LegacyFamily, readonly string[]][]) if (keys.includes(key)) return fam;
  return null;
}

/** 95% Wilson score interval lower bound for `correct` successes out of `n` (0 when n = 0). */
export function wilsonLower(correct: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = correct / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

/** 95% Wilson score interval upper bound. */
export function wilsonUpper(correct: number, n: number, z = 1.96): number {
  if (n <= 0) return 1;
  const p = correct / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (centre + margin) / (1 + z2 / n));
}

/** Does a measured family pass the penalty gate? */
export function passesGate(correct: number, n: number): boolean {
  return n >= GATE_MIN_N && correct / n >= GATE_POINT && wilsonLower(correct, n) >= GATE_LB;
}
