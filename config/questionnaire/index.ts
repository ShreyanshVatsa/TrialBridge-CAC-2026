/**
 * Question catalog entry point. `getCatalog("cancer", group)` returns the ordered,
 * group-specific questions; `enabled` is set by the precision gate: a question whose primary fact
 * family is below 85% measured precision ships switched off with a `disabledReason`, unless legacy facts
 * also back it (then the failing family is support-only via FACT_POLICY).
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import { COMMON_AFTER_GROUP, COMMON_BEFORE_GROUP, COMMON_TAIL, ESSENTIALS } from "./common";
import { GROUP_CATALOGS } from "./cancer";
import { familyPasses } from "./fact-policy";
import { FIND_OUT_ITEMS, findOutId } from "./find-out";
import { FAMILY_PRECISION } from "./precision.generated";
import type { Area, FindOutDef, QuestionDef } from "./types";

export { FACT_POLICY, factPolicy, familyPasses } from "./fact-policy";
export * from "./types";
export * from "./ids";

const applies = (q: QuestionDef, group: CancerGroupId) => (q.appliesTo === "all" || q.appliesTo.includes(group)) && !q.excludeGroups?.includes(group);

/** Apply the precision gate to one question. Pure. */
export function gate(q: QuestionDef): QuestionDef {
  if (!q.enabled || q.families.length === 0 || q.legacyFacts) return q;
  // Subtype is always asked: "ask" and "penalize" are separate decisions. Its histology facts stay support-only through
  // FACT_POLICY while the family is below the gate; the answer still shapes the query and the structured subtype match
  // (lib/match/subtype.ts), which reads the trial's registered conditions rather than criteria text.
  if (q.id === "subtype") return q;
  const primary = q.families[0] as string;
  if (familyPasses(primary)) return q;
  const p = FAMILY_PRECISION[primary as keyof typeof FAMILY_PRECISION];
  const measured = p ? `${(p.precision * 100).toFixed(0)}% on ${p.labeled} labeled facts` : "not measured";
  return { ...q, enabled: false, disabledReason: `precision gate: ${primary} facts ${measured} (< 85%)` };
}

const cache = new Map<CancerGroupId, readonly QuestionDef[]>();

export function getCatalog(area: Area, group: CancerGroupId): readonly QuestionDef[] {
  if (area !== "cancer") throw new Error(`Unknown area ${String(area)}`);
  const hit = cache.get(group);
  if (hit) return hit;
  const g = GROUP_CATALOGS[group];
  const ordered = [
    ...ESSENTIALS,
    g.subtype,
    ...COMMON_BEFORE_GROUP,
    g.biomarkers,
    ...COMMON_AFTER_GROUP,
    g.groupStatus,
    g.priorDrugs,
    ...COMMON_TAIL,
    g.deepBiomarkers,
  ].filter((q): q is QuestionDef => q !== undefined && applies(q, group));
  // Prerequisites on questions that do not exist for this group (e.g. "spread" for blood cancers) do not apply.
  const present = new Set(ordered.map((q) => q.id));
  const scoped = ordered.map((q) => (q.prerequisites?.some((p) => !present.has(p.question)) ? { ...q, prerequisites: q.prerequisites.filter((p) => present.has(p.question)) } : q));
  const out = Object.freeze(scoped.map(gate));
  cache.set(group, out);
  return out;
}

/** Find-out items keyed by find-out id (see find-out.ts). */
export function getFindOutItems(): Readonly<Record<string, FindOutDef>> {
  return FIND_OUT_ITEMS;
}

/** The find-out item for a question, if it has one. */
export function findOutFor(q: QuestionDef): FindOutDef | undefined {
  return q.findOutKey ? FIND_OUT_ITEMS[findOutId(q.findOutKey)] : undefined;
}
