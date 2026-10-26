import { z } from "zod";

/**
 * Adaptive questionnaire state (QUESTIONNAIRE_SPEC §2.5). The catalog types (
 * QuestionDef, FactRule, ...) live in config/questionnaire/types.ts and are re-exported here.
 * The state never leaves the browser: it is kept only in this tab's sessionStorage.
 */
export type { QuestionDef, FactRule, FactRelation, HardFilterPatch, FindOutDef, FactPolicy, Tier } from "@/config/questionnaire/types";
export { UNKNOWN, PREFER_NOT, SKIP, DEFERRED } from "@/config/questionnaire/types";
import { DEFERRED, NON_RESPONSE_IDS as CATALOG_NON_RESPONSE_IDS } from "@/config/questionnaire/types";

import type { FactPolicy } from "@/config/questionnaire/types";
/** FACT_POLICY shape: fact key or family -> policy entry. */
export type FactPolicyMap = Readonly<Record<string, FactPolicy>>;

/** Alias of DEFERRED ("My doctor can fill this in later"): stored as a null answer plus an entry in `deferred`. */
export const DEFER = DEFERRED;
/** Answers with identical matching semantics: no facts, no query terms, no hard filters. */
export const NON_RESPONSE_IDS: readonly string[] = [...CATALOG_NON_RESPONSE_IDS, "not_tested"];

/** Biomarker grid cell values. "not_tested" and "unknown" are non-responses (no matching effect). */
export const BIOMARKER_ANSWERS = ["positive", "negative", "not_tested", "unknown"] as const;
export type BiomarkerAnswer = (typeof BIOMARKER_ANSWERS)[number];

/** One "Find out at your next appointment" item (§5.3). */
export interface FindOutEntry {
  question: string;
  whatKey: string;
  whereKey: string;
  whyKey: string;
  /** True when the patient chose "My doctor can fill this in later". */
  deferred: boolean;
}

/** string | string[] | number | Record<string,string> | null (null = deferred / no answer). */
export const AnswerValueSchema = z.union([
  z.string().max(64),
  z.array(z.string().max(64)).max(32),
  z.number().finite(),
  z.record(z.string().max(32), z.string().max(32)),
  z.null(),
]);
export type AnswerValue = z.infer<typeof AnswerValueSchema>;

const QuestionIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);

export const QuestionnaireStateSchema = z.strictObject({
  v: z.literal(2),
  area: z.literal("cancer"),
  mode: z.enum(["quick", "thorough"]),
  answers: z.record(QuestionIdSchema, AnswerValueSchema),
  history: z.array(QuestionIdSchema).max(64),
  deferred: z.array(QuestionIdSchema).max(64),
  updatedAt: z.number().int().nonnegative(),
  /** Utility of each question when it was asked (orders the Find-out list; most useful first). */
  gains: z.record(QuestionIdSchema, z.number().finite().nonnegative()).optional(),
});
export type QuestionnaireState = z.infer<typeof QuestionnaireStateSchema>;
