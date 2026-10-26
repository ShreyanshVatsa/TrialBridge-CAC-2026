import { z } from "zod";
import { BiomarkerIdSchema, CancerGroupIdSchema, CriterionSectionSchema } from "./trial";
import { BiomarkerStatusSchema, LanguageSchema, PregnancySchema, SpreadSchema, TREATMENTS } from "./intake";
import { DRUG_CLASS_IDS, GROUP_STATUS_IDS, SUBTYPE_IDS } from "@/config/questionnaire/ids";

/**
 * Data-minimization boundary. This strict schema is the ONLY shape of patient data that may
 * leave the browser or reach an AI provider. No ZIP, exact age, location, names, or free text.
 * `z.strictObject` rejects any extra field, so accidental leaks fail validation loudly.
 */
const AGE_BRACKETS = ["18-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90+"] as const;
export const AgeBracketSchema = z.enum(AGE_BRACKETS);
export type AgeBracket = z.infer<typeof AgeBracketSchema>;

/** Treatments that may go to AI: the legacy intake list plus the questionnaire's classes (hormone therapy, stem cell transplant). */
export const AI_TREATMENTS = [...TREATMENTS, "hormone_therapy", "stem_cell_transplant"] as const;
const AiTreatmentSchema = z.enum(AI_TREATMENTS);
const YesNoUnknownSchema = z.enum(["yes", "no", "not_sure"]);

/** Coarse disease-describing categories (QUESTIONNAIRE_SPEC §4.2). Every enum includes "not_sure". */
export const STAGE_CATEGORIES = ["early", "locally_advanced", "metastatic", "no_evidence_after_surgery", "not_sure"] as const;
export const DISEASE_STATUSES = ["new", "recurrent_or_progressing", "on_treatment", "not_sure"] as const;
export const PRIOR_LINES = ["0", "1", "2", "3+", "not_sure"] as const;
export const ACTIVITY_BANDS = ["0-1", "2", "3-4", "not_sure"] as const;
export const BRAIN_METS = ["none", "treated_stable", "active", "not_sure"] as const;

/** Health-history categories: the questionnaire's own closed option lists (config/questionnaire/common.ts). */
export const SEX_LISTED = ["female", "male"] as const;
export const OTHER_CANCER = ["no", "over_2y", "recent"] as const;
export const HIV_STATUS = ["no", "controlled", "other"] as const;
export const HEPATITIS_STATUS = ["no", "hep_b", "hep_c"] as const;
export const TRANSPLANT_TYPE = ["none", "organ", "allo", "auto"] as const;
export const AUTOIMMUNE_STATUS = ["no", "yes_inactive", "yes_active"] as const;
export const ORGAN_PROBLEMS = ["kidney", "liver", "heart", "none"] as const;

/**
 * Phase preference, exact age, ZIP, travel and the deferred / find-out lists are NOT here and therefore can never
 * be sent: they stay in the browser (§4.3). Coarse health-history categories (sex, measurable disease, other cancer,
 * HIV, hepatitis, transplant, autoimmune, organ problems) may be sent so the
 * criterion judge can check exclusion rules; still closed enums only, omitted when unanswered or "not sure".
 */
export const MinimizedProfileSchema = z.strictObject({
  /** Absent = legacy intake payload (still accepted). */
  v: z.literal(2).optional(),
  cancerType: CancerGroupIdSchema,
  ageBracket: AgeBracketSchema,
  spread: SpreadSchema,
  treatments: z.array(AiTreatmentSchema).min(1).max(9),
  biomarkers: z.partialRecord(BiomarkerIdSchema, BiomarkerStatusSchema),
  pregnant: PregnancySchema,
  concurrentTrial: YesNoUnknownSchema,
  language: LanguageSchema,
  // Questionnaire-derived coarse fields, all optional (omitted when unknown, which also keeps cache hit rates up).
  subtype: z.enum(SUBTYPE_IDS).optional(),
  stageCategory: z.enum(STAGE_CATEGORIES).optional(),
  diseaseStatus: z.enum(DISEASE_STATUSES).optional(),
  priorLines: z.enum(PRIOR_LINES).optional(),
  activityBand: z.enum(ACTIVITY_BANDS).optional(),
  brainMets: z.enum(BRAIN_METS).optional(),
  groupStatus: z.enum(GROUP_STATUS_IDS).optional(),
  priorDrugClasses: z.array(z.enum(DRUG_CLASS_IDS)).min(1).max(12).optional(),
  // Health-history categories, all optional.
  sexListed: z.enum(SEX_LISTED).optional(),
  measurableDisease: z.enum(["yes", "no"]).optional(),
  otherCancer: z.enum(OTHER_CANCER).optional(),
  hivStatus: z.enum(HIV_STATUS).optional(),
  hepatitisStatus: z.enum(HEPATITIS_STATUS).optional(),
  transplantType: z.enum(TRANSPLANT_TYPE).optional(),
  autoimmuneStatus: z.enum(AUTOIMMUNE_STATUS).optional(),
  organProblems: z.array(z.enum(ORGAN_PROBLEMS)).min(1).max(4).optional(),
});
export type MinimizedProfile = z.infer<typeof MinimizedProfileSchema>;

export const NctIdSchema = z.string().regex(/^NCT\d{8}$/);

/** POST /api/analyze request body. */
export const AnalyzeRequestSchema = z.strictObject({
  profile: MinimizedProfileSchema,
  nctIds: z.array(NctIdSchema).min(1).max(15),
  turnstileToken: z.string().min(1).max(2048),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const FitLevelSchema = z.enum(["strong", "possible", "unlikely", "unclear"]);
export type FitLevel = z.infer<typeof FitLevelSchema>;

export const AssessmentSchema = z.enum(["likely_met", "likely_not_met", "needs_doctor"]);
export type Assessment = z.infer<typeof AssessmentSchema>;

export const CriterionAssessmentSchema = z.strictObject({
  section: CriterionSectionSchema,
  number: z.number().int().positive(),
  /** Verbatim English criterion text (verified server-side against the trial's own copy). */
  quote: z.string().min(1).max(2000),
  assessment: AssessmentSchema,
  /** Plain-language explanation in the user's language. */
  explanation: z.string().min(1).max(600),
});
export type CriterionAssessment = z.infer<typeof CriterionAssessmentSchema>;

export const TrialAnalysisSchema = z.strictObject({
  nctId: NctIdSchema,
  fitLevel: FitLevelSchema,
  criteria: z.array(CriterionAssessmentSchema).max(12),
  doctorQuestions: z.array(z.string().min(1).max(300)).max(5),
  summary: z.string().min(1).max(400),
});
export type TrialAnalysis = z.infer<typeof TrialAnalysisSchema>;

export const AnalyzeResponseSchema = z.strictObject({
  /** ok = AI analysis present; degraded = AI unavailable, use retrieval + rules only. */
  status: z.enum(["ok", "degraded"]),
  provider: z.string().nullable(),
  results: z.array(TrialAnalysisSchema),
  /** True when output language is Haitian Creole (AI output marked experimental). */
  experimental: z.boolean(),
  cached: z.boolean(),
  /** Machine-readable reason when degraded; UI maps it to a friendly, translated notice. */
  degradedReason: z.enum(["ai_unavailable", "rate_limited", "budget_exhausted", "invalid_output"]).optional(),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

/** Typed backend error envelope. Messages are safe to show; the UI maps `code` to translated text. */
export const ApiErrorCodeSchema = z.enum([
  "bad_request",
  "payload_too_large",
  "forbidden_origin",
  "turnstile_failed",
  "rate_limited",
  "not_found",
  "method_not_allowed",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export const ApiErrorSchema = z.object({ error: z.object({ code: ApiErrorCodeSchema, message: z.string(), requestId: z.string() }) });
