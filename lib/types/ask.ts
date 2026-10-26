import { z } from "zod";
import { LanguageSchema } from "./intake";
import { NctIdSchema } from "./analysis";

/** Trial Q&A (POST /api/ask). The question is scrubbed of likely personal info before sending. */
export const MAX_QUESTION_CHARS = 300;
export const MAX_QUESTIONS_PER_TRIAL = 10;

export const AskRequestSchema = z.strictObject({
  nctId: NctIdSchema,
  question: z.string().trim().min(2).max(MAX_QUESTION_CHARS),
  language: LanguageSchema,
  turnstileToken: z.string().min(1).max(2048),
});

export const AskKindSchema = z.enum(["answer", "not_in_text", "refusal", "crisis"]);
export type AskKind = z.infer<typeof AskKindSchema>;
export const RefusalReasonSchema = z.enum(["off_topic", "diagnosis", "treatment_advice", "eligibility"]);
export type RefusalReason = z.infer<typeof RefusalReasonSchema>;

/** Where an answer comes from: a numbered criterion, or the trial's summary/title. */
export const CitationSchema = z.strictObject({
  section: z.enum(["inclusion", "exclusion", "summary", "title"]),
  /** Criterion number for inclusion/exclusion; null for summary/title. */
  number: z.number().int().positive().nullable(),
  /** Verbatim English excerpt (verified server-side). */
  quote: z.string().min(1).max(1500),
});
export type Citation = z.infer<typeof CitationSchema>;

export const AskResponseSchema = z.strictObject({
  status: z.enum(["ok", "degraded"]),
  kind: AskKindSchema.nullable(),
  refusalReason: RefusalReasonSchema.optional(),
  /** Plain-language text in the user's language (empty when degraded). */
  answer: z.string(),
  citations: z.array(CitationSchema).max(5),
  /** True => show crisis resources (U.S.: call or text 988; emergencies: 911) prominently. */
  crisis: z.boolean(),
  /** True when likely personal info was removed from the question before processing. */
  piiRemoved: z.boolean(),
  experimental: z.boolean(),
  cached: z.boolean(),
  provider: z.string().nullable(),
  degradedReason: z.enum(["ai_unavailable", "rate_limited", "budget_exhausted", "invalid_output", "question_limit"]).optional(),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;
