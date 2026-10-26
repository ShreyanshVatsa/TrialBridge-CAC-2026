/**
 * Matching policy per fact key (contract C1, QUESTIONNAIRE_SPEC §3.2, §7.3). A fact family may
 * penalize (create conflicts) only when its measured precision (held-out labels) is >= 85%; otherwise its facts are
 * support-only. v7: the v1 keys are measured too (held-out labels, eval/facts-labels-v3.json); a v1 key below the
 * gate keeps a half-weight penalty but never a hard failure (`belowGate`); one without labels keeps penalize, weight 1.
 */
import { BASE_FACT_KEYS } from "@/lib/types/trial";
import { FACT_FAMILIES, familyOf, type FactFamily } from "@/lib/ingest/eligibility-facts";
import type { FactPolicy } from "./types";
import { FAMILY_PRECISION } from "./precision.generated";
import { V1_KEY_PRECISION } from "./precision-v1.generated";

/** Score weight per family (§3.2): carve-out-heavy families count half; subtype and biomarker requirements 1.2. */
const FAMILY_WEIGHT: Partial<Record<FactFamily, number>> = {
  other_malignancy: 0.5,
  organ_disease: 0.5,
  measurable: 0.5,
  histology: 1.2,
  biomarker_v2: 1.2,
};

/** Does a family pass the precision gate? */
export function familyPasses(family: string): boolean {
  return FAMILY_PRECISION[family as FactFamily]?.passes === true;
}

function policyFor(family: FactFamily): FactPolicy {
  const pass = familyPasses(family);
  return { penalize: pass, weight: FAMILY_WEIGHT[family] ?? 1, ...(pass ? {} : { supportOnly: true }) };
}

const V1_KEYS = BASE_FACT_KEYS.filter((k) => familyOf(k) === null);

function v1Policy(key: string): FactPolicy {
  const p = V1_KEY_PRECISION[key];
  if (!p || p.passes) return { penalize: true, weight: 1 };
  // Below the gate on held-out labels, yet removing the penalty lowered TREC 2021 dev nDCG@10 (baseline 0.484 ->
  // 0.451): kept as a half-weight ranking signal that never makes a hard failure (docs/dev/FACTS.md).
  return { penalize: true, weight: 0.5, belowGate: true };
}

/**
 * Keys: exact base keys, plus the wildcards "histology:*", "prior_drug:*" and "biomarker:*".
 * The first biomarkers (HER2, EGFR, ...) are listed explicitly so the catalog-marker family gate does not touch them.
 */
export const FACT_POLICY: Readonly<Record<string, FactPolicy>> = Object.freeze({
  ...Object.fromEntries(V1_KEYS.map((k) => [k, v1Policy(k)])),
  "biomarker:*": { penalize: true, weight: 1.2 },
  ...Object.fromEntries((Object.keys(FACT_FAMILIES) as FactFamily[]).flatMap((fam) => FACT_FAMILIES[fam].map((k) => [k, policyFor(fam)]))),
});

/** Policy for a concrete fact key (exact match, then its `prefix:*` wildcard); unknown keys never penalize. */
export function factPolicy(key: string): FactPolicy {
  const exact = FACT_POLICY[key];
  if (exact) return exact;
  const i = key.indexOf(":");
  const wild = i > 0 ? FACT_POLICY[`${key.slice(0, i)}:*`] : undefined;
  return wild ?? { penalize: false, weight: 1, supportOnly: true };
}
