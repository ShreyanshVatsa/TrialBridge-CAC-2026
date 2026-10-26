/**
 * Questionnaire catalog types (QUESTIONNAIRE_SPEC §1.2). Questions are data: a new
 * disease area is a new catalog folder plus an `area` value, with no engine changes.
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import type { BiomarkerId } from "@/config/biomarkers";
import type { FactKey } from "@/lib/types/trial";
import type { AiFieldId, QuestionId } from "./ids";

export type { AiFieldId, QuestionId } from "./ids";

export type Tier = "essential" | "helpful" | "deep";
export type AnswerType = "group_picker" | "age" | "zip" | "travel" | "single" | "multi" | "biomarker_grid";
export type Area = "cancer";

/** Reserved option ids. Every non-essential question MUST include "unknown"; "prefer_not" on sensitive ones. */
export const UNKNOWN = "unknown";
export const PREFER_NOT = "prefer_not";
export const SKIP = "__skip";
/** "My doctor can fill this in later" (cost-3 questions). Same matching semantics as unknown. */
export const DEFERRED = "deferred";
export const NON_RESPONSE_IDS: readonly string[] = [UNKNOWN, PREFER_NOT, SKIP, DEFERRED];

/**
 * English message key. Strings live in components/i18n/en.ts under `questionnaire.*` / `findOut.*`;
 * defaults for every key are in ./en-defaults.ts. Kept as a template type so the
 * catalog compiles independently of the i18n rewrite; tests check every key exists.
 */
export type MessageKey = `questionnaire.${string}` | `findOut.${string}`;

export interface OptionDef {
  id: string;
  labelKey: MessageKey;
  helpKey?: MessageKey;
  exclusiveWith?: string[];
}

/** All prereqs must hold. `anyOf` lists option ids of an earlier question. */
export interface Prereq {
  question: QuestionId;
  anyOf: string[];
  /** true = the prerequisite holds when the answer is NOT one of `anyOf` (e.g. "spread ≠ adjuvant"). */
  negate?: boolean;
}

export type FactRelation = "conflict" | "support" | "neutral";

/**
 * How one option relates to one trial fact. `paramCompare` covers thresholds: the patient's value is
 * compared with the trial's `param` (e.g. ecog_max): `op: "lte"` means the patient fits when
 * patientValue <= trialParam; otherwise `else` applies.
 * `paramIn` restricts a rule to facts whose string param is in the list (`"*"` matches facts without a param),
 * e.g. brain_mets excluded with param "active_only" conflicts only for "active".
 */
export interface FactRule {
  fact: FactKey;
  whenRequired?: FactRelation;
  whenExcluded?: FactRelation;
  paramCompare?: { op: "lte" | "gte"; value: number; else: FactRelation };
  paramIn?: readonly string[];
}

/** Hard filters an option may set (definite answers only). */
export interface HardFilterPatch {
  sex?: "FEMALE" | "MALE";
}

export interface OptionEffect {
  option: string;
  facts: FactRule[];
  /** English, for BM25 + embedding profile text. */
  queryTerms?: string[];
  hardFilter?: HardFilterPatch;
}

export interface QuestionDef {
  id: QuestionId;
  area: Area;
  tier: Tier;
  type: AnswerType;
  /** Plain language, grade 6-8. */
  labelKey: MessageKey;
  helpKey: MessageKey;
  whyKey: MessageKey;
  /** Shown in the "Find out at your next appointment" list when unknown. */
  findOutKey?: MessageKey;
  options?: OptionDef[];
  biomarkers?: BiomarkerId[];
  appliesTo: readonly CancerGroupId[] | "all";
  excludeGroups?: readonly CancerGroupId[];
  prerequisites?: Prereq[];
  /** 1 = most patients know it, 2 = may need to think or check, 3 = usually needs a report. */
  cost: 1 | 2 | 3;
  /** Sex, HIV, hepatitis, pregnancy: adds prefer_not. A "prefer not" answer is never sent to AI. */
  sensitive?: boolean;
  effects: OptionEffect[];
  /** Present only if the coarse answer may go to AI (§4). */
  aiField?: AiFieldId;
  /** P(option), including unknown; used by the engine. */
  priors?: Partial<Record<CancerGroupId, Record<string, number>>>;
  /** false until the backing facts pass the precision gate (§7). */
  enabled: boolean;
  /** Why the question is off (precision gate, no backing facts). Present iff enabled is false. */
  disabledReason?: string;
  /** Evidence line, e.g. "lung 31% EGFR mention (national 2026-10-07)". */
  evidence: string;
  /** Fact families backing this question (keys of FACT_FAMILIES); [] for hard filters or soft-only questions. */
  families: readonly string[];
  /** Also backed by legacy rule facts (metastatic, prior_*, pregnancy, ...), which keep the legacy matching behavior. */
  legacyFacts?: boolean;
  /** Ask only when the patient's age is at most this (e.g. pregnancy: under 60). */
  maxAge?: number;
}

/** "Find out at your next appointment" item (§5.3). */
export interface FindOutDef {
  whatKey: MessageKey;
  whereKey: MessageKey;
  whyKey: MessageKey;
}

/** Matching policy per fact key or family. */
export interface FactPolicy {
  /** May a conflict lower the score? Only at >= 85% measured precision. */
  penalize: boolean;
  /** Score weight multiplier (FACT_WEIGHT, §3.2). */
  weight: number;
  /** Only supports count (no penalties). */
  supportOnly?: boolean;
  /**
   * v7: below the precision gate but kept as a soft ranking signal (v1 keys, eval/facts-labels-v3.json). Such a fact
   * may lower the score at its weight, but never creates a hard failure (Tier B) in the per-criterion resolver.
   */
  belowGate?: boolean;
}
