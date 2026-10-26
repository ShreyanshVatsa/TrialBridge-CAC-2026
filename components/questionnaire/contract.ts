/**
 * UI-side view of the questionnaire contracts (docs/dev/QUESTIONNAIRE_SPEC.md §1.2, §2.5).
 * Types come from lib/types/questionnaire; this file adds UI helpers so components import from one place.
 */
import {
  DEFER,
  NON_RESPONSE_IDS,
  PREFER_NOT,
  SKIP,
  UNKNOWN,
  type AnswerValue,
  type QuestionDef,
  type QuestionnaireState,
} from "@/lib/types/questionnaire";

export {
  BIOMARKER_ANSWERS,
  DEFER,
  PREFER_NOT,
  SKIP,
  UNKNOWN,
  type AnswerValue,
  type BiomarkerAnswer,
  type FindOutEntry,
  type QuestionDef,
  type QuestionnaireState,
  type Tier,
} from "@/lib/types/questionnaire";

/** UI code treats ids and message keys as plain strings (the catalog's narrower types are assignable). */
export type QuestionId = string;
export type MessageKey = string;

export type NextStep =
  | { kind: "ask"; question: QuestionDef; utility: number; impact: { total: number; narrowedTo: number | null } }
  | { kind: "done"; reason: "small_set" | "low_gain" | "max_questions" | "exhausted" };

export interface LiveCount {
  total: number;
  noConflict: number;
  supported: number;
}

/** Essentials, in the fixed order the flow asks them (spec §2.1). */
export const ESSENTIAL_IDS = ["cancer_type", "age", "zip", "travel"] as const;

export function isEssential(id: string): boolean {
  return (ESSENTIAL_IDS as readonly string[]).includes(id);
}

export function emptyState(): QuestionnaireState {
  return { v: 2, area: "cancer", mode: "quick", answers: {}, history: [], deferred: [], updatedAt: Date.now() };
}

/** Not sure / skip / prefer not / deferred: identical matching semantics (no facts, no filters). */
export function isNonResponse(value: AnswerValue | undefined): boolean {
  if (value === null) return true;
  if (typeof value === "string") return NON_RESPONSE_IDS.includes(value);
  if (Array.isArray(value)) return value.length === 1 && value[0] === UNKNOWN;
  return false;
}

type NonResponseKind = "unknown" | "skip" | "prefer_not" | "deferred";

export function nonResponseKind(state: QuestionnaireState, id: string): NonResponseKind | null {
  if (isEssential(id)) return null; // travel null = "anywhere", not a non-response
  if (state.deferred.includes(id)) return "deferred";
  const v = state.answers[id];
  if (v === SKIP) return "skip";
  if (v === PREFER_NOT) return "prefer_not";
  if (v === DEFER) return "deferred";
  return isNonResponse(v) ? "unknown" : null;
}
