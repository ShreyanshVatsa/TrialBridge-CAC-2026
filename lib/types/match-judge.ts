import { z } from "zod";
import { MinimizedProfileSchema, NctIdSchema } from "./analysis";
import { MATCH_JUDGE } from "@/config/match-judge";
import type { TrialCriteriaLabels } from "./criteria";

const CriterionIdSchema = z.string().regex(/^[IE][1-9]\d{0,3}$/);

/**
 * POST /api/match request body. Per trial: the criterion ids the deterministic resolver left unknown, and the
 * splitter version they came from. The server reads the criterion text from its own copy (never from the browser).
 */
export const MatchRequestSchema = z.strictObject({
  profile: MinimizedProfileSchema,
  trials: z
    .array(
      z.strictObject({
        nctId: NctIdSchema,
        criteriaVersion: z.number().int().positive(),
        unknownIds: z.array(CriterionIdSchema).max(MATCH_JUDGE.maxItemsPerTrial),
      }),
    )
    .min(1)
    .max(MATCH_JUDGE.topN),
  turnstileToken: z.string().min(1).max(2048),
});
export type MatchRequest = z.infer<typeof MatchRequestSchema>;

const CriterionLabelSchema = z.strictObject({
  id: CriterionIdSchema,
  section: z.enum(["inclusion", "exclusion"]),
  label: z.enum(["met", "not_met", "unknown", "not_applicable", "excluded", "not_excluded"]),
  source: z.enum(["rule", "llm", "default"]),
  reason: z.string().optional(),
  answerIds: z.array(z.string()).optional(),
});

const TrialCriteriaLabelsSchema = z.strictObject({
  trialId: NctIdSchema,
  criteriaVersion: z.number().int().positive(),
  labels: z.array(CriterionLabelSchema),
  provider: z.string().nullable(),
  coverage: z.number().min(0).max(1).optional(),
  promptVersion: z.string().optional(),
}) satisfies z.ZodType<TrialCriteriaLabels>;

export const MatchResponseSchema = z.strictObject({
  status: z.enum(["ok", "degraded"]),
  provider: z.string().nullable(),
  results: z.array(TrialCriteriaLabelsSchema),
  /** Trials served from the cache. */
  cachedIds: z.array(NctIdSchema),
  /** Trials the server could not judge (unknown trial, no split criteria, or a different criteria version). */
  skippedIds: z.array(NctIdSchema),
  degradedReason: z.enum(["ai_unavailable", "rate_limited", "budget_exhausted", "invalid_output"]).optional(),
});
export type MatchResponse = z.infer<typeof MatchResponseSchema>;
