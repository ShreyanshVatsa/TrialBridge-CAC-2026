/** Builders for the per-group questions (subtype, group status, prior drug classes, biomarker grids). */
import type { CancerGroupId } from "@/config/cancer-groups";
import { BIOMARKERS_BY_GROUP, DEEP_BIOMARKERS_BY_GROUP, type BiomarkerId } from "@/config/biomarkers";
import type { FactKey } from "@/lib/types/trial";
import { findOutKey, has, lacks, nonResponseEffects, optKey, options, priors, question } from "../build";
import type { DrugClassId, GroupStatusId, HistologyId, SubtypeId } from "../ids";
import { DEFERRED, SKIP, UNKNOWN, type FactRule, type OptionEffect, type QuestionDef } from "../types";

/** What the trial must exist for a group's questions. */
export interface GroupCatalog {
  group: CancerGroupId;
  /** Subtype question (omitted for groups where subtype is not a top splitter, §0.4.3). */
  subtype?: QuestionDef;
  groupStatus?: QuestionDef;
  priorDrugs?: QuestionDef;
  biomarkers?: QuestionDef;
  deepBiomarkers?: QuestionDef;
}

interface SubtypeOption {
  id: SubtypeId;
  /** Histologies the patient's cancer IS: required => support, excluded => conflict. */
  is: readonly HistologyId[];
  /** Histologies it is NOT: a trial requiring one of them => conflict. */
  isNot: readonly HistologyId[];
  queryTerms: string[];
  prior: number;
}

export function subtypeQuestion(group: CancerGroupId, opts: readonly SubtypeOption[], evidence: string): QuestionDef {
  return question({
    id: "subtype",
    keyBase: `subtype.${group}`,
    tier: "helpful",
    type: "single",
    options: [...options("subtype", opts.map((o) => o.id)), { id: DEFERRED, labelKey: "questionnaire.common.deferred" }],
    appliesTo: [group],
    prerequisites: [{ question: "cancer_type", anyOf: [group] }],
    cost: 2,
    effects: [
      ...opts.map(
        (o): OptionEffect => ({
          option: o.id,
          facts: [...o.is.map((h) => has(`histology:${h}` as FactKey)), ...o.isNot.map((h) => lacks(`histology:${h}` as FactKey))],
          queryTerms: o.queryTerms,
        }),
      ),
      ...nonResponseEffects(),
      { option: DEFERRED, facts: [] },
    ],
    findOutKey: findOutKey("subtype"),
    aiField: "subtype",
    priors: { [group]: priors(Object.fromEntries(opts.map((o) => [o.id, o.prior]))) },
    enabled: true,
    evidence,
    families: ["histology"],
  });
}

interface StatusOption {
  id: GroupStatusId;
  facts: FactRule[];
  queryTerms: string[];
  prior: number;
}

export function groupStatusQuestion(group: CancerGroupId, opts: readonly StatusOption[], evidence: string, families: readonly string[] = ["group_status"]): QuestionDef {
  return question({
    id: "group_status",
    keyBase: `group_status.${group}`,
    tier: "helpful",
    type: "single",
    options: [...options("group_status", opts.map((o) => o.id)), { id: DEFERRED, labelKey: "questionnaire.common.deferred" }],
    appliesTo: [group],
    cost: 2,
    effects: [...opts.map((o): OptionEffect => ({ option: o.id, facts: o.facts, queryTerms: o.queryTerms })), ...nonResponseEffects(), { option: DEFERRED, facts: [] }],
    findOutKey: findOutKey(`group_status.${group}`),
    aiField: "groupStatus",
    priors: { [group]: priors(Object.fromEntries(opts.map((o) => [o.id, o.prior]))) },
    enabled: true,
    evidence,
    families,
  });
}

/** Display examples for drug classes live in the option label (en-defaults), e.g. "CDK4/6 inhibitor (Ibrance, Kisqali, Verzenio)". */
export function priorDrugsQuestion(group: CancerGroupId, classes: readonly DrugClassId[], evidence: string): QuestionDef {
  return question({
    id: "prior_drugs",
    tier: "helpful",
    type: "multi",
    options: options("prior_drugs", [...classes, "none_of_these"], { exclusive: ["none_of_these"] }),
    appliesTo: [group],
    prerequisites: [{ question: "treatments", anyOf: ["none"], negate: true }],
    cost: 2,
    effects: [
      ...classes.map((c): OptionEffect => ({ option: c, facts: [has(`prior_drug:${c}` as FactKey)], queryTerms: [] })),
      { option: "none_of_these", facts: classes.map((c) => lacks(`prior_drug:${c}` as FactKey)), queryTerms: [] },
      ...nonResponseEffects(),
    ],
    findOutKey: findOutKey("prior_drugs"),
    aiField: "priorDrugClasses",
    priors: { [group]: priors({ ...Object.fromEntries(classes.map((c) => [c, 0.5 / classes.length])), none_of_these: 0.25, [UNKNOWN]: 0.25 }) },
    enabled: true,
    evidence,
    families: ["prior_drug"],
  });
}

/** Grid status ids (per marker). "not_tested" and "unknown" carry no facts. */
const GRID_STATUSES = ["positive", "negative", "not_tested"] as const;

function gridEffects(markers: readonly BiomarkerId[]): OptionEffect[] {
  return markers.flatMap((b): OptionEffect[] => [
    { option: `${b}:positive`, facts: [has(`biomarker:${b}` as FactKey)], queryTerms: [`${b} positive`] },
    { option: `${b}:negative`, facts: [lacks(`biomarker:${b}` as FactKey, { whenExcluded: "support" })], queryTerms: [`${b} negative`] },
    { option: `${b}:not_tested`, facts: [] },
    { option: `${b}:${UNKNOWN}`, facts: [] },
    { option: `${b}:${SKIP}`, facts: [] },
  ]);
}

export function biomarkerQuestion(group: CancerGroupId, evidence: string, extra: OptionEffect[] = []): QuestionDef | undefined {
  const markers = BIOMARKERS_BY_GROUP[group];
  if (markers.length === 0) return undefined;
  return question({
    id: "biomarkers",
    tier: "helpful",
    type: "biomarker_grid",
    options: [...options("biomarkers", [...GRID_STATUSES, ...extra.map((e) => e.option)]), { id: DEFERRED, labelKey: "questionnaire.common.deferred" }],
    biomarkers: markers,
    appliesTo: [group],
    prerequisites: [{ question: "cancer_type", anyOf: [group] }],
    cost: 3,
    effects: [...gridEffects(markers), ...extra, ...nonResponseEffects(), { option: DEFERRED, facts: [] }],
    findOutKey: findOutKey("biomarkers"),
    aiField: "biomarkers",
    priors: { [group]: priors({ positive: 0.25, negative: 0.25, not_tested: 0.1, [UNKNOWN]: 0.4 }) },
    enabled: true,
    evidence,
    families: ["biomarker_v2"],
    legacyFacts: true,
  });
}

export function deepBiomarkerQuestion(group: CancerGroupId, evidence: string): QuestionDef | undefined {
  const markers = DEEP_BIOMARKERS_BY_GROUP[group];
  if (!markers?.length) return undefined;
  return question({
    id: "deep_biomarkers",
    tier: "deep",
    type: "biomarker_grid",
    options: [...options("deep_biomarkers", GRID_STATUSES), { id: DEFERRED, labelKey: "questionnaire.common.deferred" }],
    biomarkers: markers,
    appliesTo: [group],
    prerequisites: [{ question: "biomarkers", anyOf: [], negate: true }],
    cost: 3,
    effects: [...gridEffects(markers), ...nonResponseEffects(), { option: DEFERRED, facts: [] }],
    findOutKey: findOutKey("biomarkers"),
    priors: { [group]: priors({ positive: 0.1, negative: 0.2, not_tested: 0.2, [UNKNOWN]: 0.5 }) },
    enabled: true,
    evidence,
    families: ["biomarker_v2"],
    legacyFacts: (markers as readonly string[]).some((m) => ["MSI-H", "NTRK", "BRCA", "HER2"].includes(m)),
  });
}

export { optKey };
