/**
 * Structured subtype match: the patient's chosen subtype (lung: SCLC vs NSCLC; leukemia: AML vs CLL; ...) against the
 * histologies the TRIAL ITSELF registers in its structured conditions and title. This is a different signal from
 * the criteria-text histology facts (precision 67%, support-only): a registered condition list is the sponsor's own
 * statement of the disease, so a match is high precision.
 *
 *   match    +1  the trial registers a histology the patient has (e.g. patient AML, conditions "Acute Myeloid Leukemia")
 *   conflict -1  the trial registers histologies and ALL of them are ones the patient does NOT have
 *    0           the patient gave no subtype (or a non-response), or the trial names no histology of the group
 *
 * v9: the patient's subtype answer may also list sibling-disease tags (config/subtype-tags.ts: non-Hodgkin for a
 * Hodgkin patient, brain metastases for a glioma, ...). Those tags join the trial's histologies only for that patient:
 * a conflict tag counts as a histology the patient does not have; an `own` tag means the trial may be about the
 * patient's disease, so the trial is never a conflict.
 *
 * "Unknown" / skip / deferred subtype answers compile to no rules, so they return 0 here: unknown never lowers rank.
 */
import { HISTOLOGY_PATTERNS } from "@/config/criteria";
import { SUBTYPE_TAG_RULES, SUBTYPE_TAGS } from "@/config/subtype-tags";
import type { CancerGroupId } from "@/config/cancer-groups";
import type { CompiledAnswer } from "@/lib/questionnaire/rules";
import type { TrialCard } from "@/lib/types/trial";

export interface SubtypeProfile {
  /** Histologies the patient's cancer is (e.g. "nsclc"). */
  is: ReadonlySet<string>;
  /** Histologies it is not. */
  isNot: ReadonlySet<string>;
  /** Sibling-disease tags (config/subtype-tags.ts) that mean another disease, and tags that may be the patient's. */
  conflictTags?: ReadonlySet<string>;
  ownTags?: ReadonlySet<string>;
}

/** Question ids whose answer names the patient's subtype (`group_status` in groups like myeloma and bladder). */
const SUBTYPE_QUESTIONS = ["subtype", "group_status"];

/**
 * The patient's subtype as histology sets, read from the compiled `subtype` (or `group_status`) answer, plus the
 * sibling-disease tags of the chosen option (`answers`: the raw questionnaire answers); null when not answered.
 */
export function subtypeProfile(compiled: readonly CompiledAnswer[], answers: Readonly<Record<string, unknown>> = {}): SubtypeProfile | null {
  const is = new Set<string>();
  const isNot = new Set<string>();
  for (const c of compiled) {
    if (!SUBTYPE_QUESTIONS.includes(c.question)) continue;
    for (const [key, rules] of c.rules) {
      if (!key.startsWith("histology:")) continue;
      const id = key.slice("histology:".length);
      for (const { rule } of rules) {
        if (rule.whenRequired === "support") is.add(id);
        else if (rule.whenRequired === "conflict") isNot.add(id);
      }
    }
  }
  const conflictTags = new Set<string>();
  const ownTags = new Set<string>();
  for (const q of SUBTYPE_QUESTIONS) {
    const v = answers[q];
    const rule = typeof v === "string" ? SUBTYPE_TAG_RULES[v] : undefined;
    for (const t of rule?.conflict ?? []) conflictTags.add(t);
    for (const t of rule?.own ?? []) ownTags.add(t);
  }
  if (is.size + isNot.size + conflictTags.size + ownTags.size === 0) return null;
  return { is, isNot, ...(conflictTags.size > 0 ? { conflictTags } : {}), ...(ownTags.size > 0 ? { ownTags } : {}) };
}

const tagCache = new Map<string, ReadonlySet<string>>();

/** Histology ids a trial's registered conditions and titles name, for a cancer group. Cached per trial text. */
function trialHistologies(card: Partial<Pick<TrialCard, "conditions" | "title" | "officialTitle">>, group: CancerGroupId): ReadonlySet<string> {
  const text = [...(card.conditions ?? []), card.title ?? "", card.officialTitle ?? ""].join(" ; ");
  const cacheKey = `${group}|${text}`;
  const hit = tagCache.get(cacheKey);
  if (hit) return hit;
  const ids = new Set<string>();
  for (const h of HISTOLOGY_PATTERNS) if (h.groups.includes(group) && h.re.test(text) && !h.negated?.test(text)) ids.add(h.id);
  for (const t of SUBTYPE_TAGS) if (t.groups.includes(group) && t.re.test(text)) ids.add(t.id);
  // "Squamous NSCLC" names one disease: the parent/child pair is not a list of competing diseases.
  if (ids.has("nsclc") && ids.has("lung_squamous")) ids.delete("lung_squamous");
  if (tagCache.size > 20000) tagCache.clear();
  tagCache.set(cacheKey, ids);
  return ids;
}

/** +1 match, -1 conflict, 0 neutral. */
export function subtypeMatch(profile: SubtypeProfile | null, card: Partial<Pick<TrialCard, "conditions" | "title" | "officialTitle">>, group: CancerGroupId): -1 | 0 | 1 {
  if (!profile) return 0;
  const extra = new Set(SUBTYPE_TAGS.map((t) => t.id));
  const all = [...trialHistologies(card, group)];
  for (const t of all) if (profile.is.has(t)) return 1;
  // Specific histologies decide on their own, exactly as before the sibling tags existed.
  const specific = all.filter((t) => !extra.has(t));
  if (specific.length > 0) return specific.every((t) => profile.isNot.has(t) || profile.conflictTags?.has(t)) ? -1 : 0;
  // Only family-level tags: another disease when one is a conflict for this patient and none may be theirs.
  if (all.some((t) => profile.ownTags?.has(t))) return 0;
  return all.some((t) => profile.conflictTags?.has(t)) ? -1 : 0;
}
