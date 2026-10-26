import type { CancerGroupId } from "@/config/cancer-groups";

/**
 * Named constants of the adaptive questionnaire engine (QUESTIONNAIRE_SPEC §2). Every number that
 * shapes which question is asked next lives here, with the reason, so the behavior is auditable.
 */

/** Essential questions, always first and in this order. They are hard filters and cannot be skipped. */
export const Q_CANCER_TYPE = "cancer_type";
export const Q_AGE = "age";
export const Q_ZIP = "zip";
export const Q_TRAVEL = "travel";
export const ESSENTIAL_ORDER = [Q_CANCER_TYPE, Q_AGE, Q_ZIP, Q_TRAVEL] as const;

/** Information gain is measured over the K best-scoring candidates (the ones a patient would actually see). */
export const TOP_K = 60;
/** Softmax temperature over candidate scores: p(t) ∝ exp(score / TAU). 0.15 puts
 *  almost all mass on the top 1-3 trials once one pulls ahead, so information gain went to ~0 while trials 4-10
 *  (what the patient sees) could still change. 0.5 spreads mass over roughly the top 10-20: in the national
 *  simulation (5,726 trials, 120 patients) adaptive nDCG@10 at k = 1..7 rose from 0.731-0.825 to 0.746-0.901. */
export const TAU = 0.5;
/** Question value = INFO_GAIN_WEIGHT * (bits of information about the top-K candidates) + REGRET_WEIGHT * (expected top-10
 *  change, 0..1; engine.ts expectedRegret). Entropy alone spends questions on trials 20-60 that the patient never sees;
 *  the top-10 term values what is shown. On the national simulation (tuning split: seed 777, six even groups) adding it moved
 *  adaptive - fixed nDCG@10 at k = 1/3/5/7 from +0.119/+0.033/-0.023/-0.013 to +0.082/+0.034/+0.002/+0.004; weights 1:1 won over 0:1,
 *  1:0, 1:0.5, 1:2 (1:0 gave the best k = 5-7 but a weaker k = 1). */
export const INFO_GAIN_WEIGHT = 1;
export const REGRET_WEIGHT = 1;
/** Size of the result list the regret term protects: the ten results a patient sees first. */
export const REGRET_TOP_N = 10;

/** Likelihood of an answer for a trial it conflicts with: e^-LAMBDA. */
export const LAMBDA = 1.2;
/** Likelihood of an answer for a trial it supports: e^+MU. LAMBDA : MU mirrors CONFLICT_PENALTY : SUPPORT_BONUS damped. */
export const MU = 0.4;
/** Likelihood used when a hypothetical answer would hard-filter the trial (definite sex): twice a conflict's
 *  strength. For "which trials end up on top" a removed trial and a penalized one differ little; a near-zero
 *  likelihood made the sex question look ~2x more useful than it is in simulation (QUESTIONNAIRE_SPEC §7.2). */
export const HARD_EXCLUDED_LIKELIHOOD = Math.exp(-2 * LAMBDA);

/** Tier multipliers on utility. Deep-dive questions are optional in quick mode, so they are demoted. */
export const TIER_FACTOR = {
  quick: { essential: Number.POSITIVE_INFINITY, helpful: 1.0, deep: 0.6 },
  thorough: { essential: Number.POSITIVE_INFINITY, helpful: 1.0, deep: 1.0 },
} as const;

interface StopRule {
  /** Stop when the best remaining utility (bits per unit of answer difficulty) falls below this. */
  minUtility: number;
  /** Stop after this many adaptive (non-essential) questions. */
  maxQuestions: number;
  /** Stop when this few trials have no likely conflict (null = never in this mode). */
  smallSet: number | null;
}
/**
 * Spec §2.3 proposed 0.05 / 0.01 bits. With real-world fact density (~4 directional facts per trial) one
 * answer moves only a few hundredths of a bit over the top 60, so 0.05 stopped quick mode after ~2 questions
 * (simulated nDCG@10 0.61 vs 0.85 for the full fixed flow). 0.01 gives a median of ~6 questions and 0.78;
 * thorough keeps the same 5x ratio. Calibrated in tests/unit/qn-simulate.test.ts.
 * Quick was then retuned: with the regret term the cap of 7 decided every flow (median 7). Quick
 * minUtility 0.02 stops patients whose next question is worth little (median 5, mean ~5.3 on 408 national
 * patients, tuning seed 101, verified on seed 202); a plain cap of 5 cost more nDCG@10 for the same mean length.
 */
export const STOP_RULES: Record<"quick" | "thorough", StopRule> = {
  quick: { minUtility: 0.02, maxQuestions: 7, smallSet: 12 },
  thorough: { minUtility: 0.002, maxQuestions: 20, smallSet: null },
};

/** The sex question is shown only when at least this share of current candidates is sex-restricted. */
export const SEX_ASK_MIN_SHARE = 0.05;
export const Q_SEX = "sex";

/** After this many "don't know"-type answers in a row of the same kind... */
export const UNKNOWN_STREAK = 2;
/** ...questions of that kind that patients often cannot answer (prior P(unknown) >= HIGH_UNKNOWN_PRIOR)... */
export const HIGH_UNKNOWN_PRIOR = 0.6;
/** ...have their utility multiplied by this. */
export const FAMILY_DOWNWEIGHT = 0.5;

/** Default P(unknown) when the catalog gives no prior for the group; definite options share the rest equally. */
export const DEFAULT_P_UNKNOWN = 0.2;
/** Default biomarker priors per marker (spec §7.2: patients answer "don't know" to biomarkers ~40% of the time). */
export const DEFAULT_BIOMARKER_PRIOR = { positive: 0.2, negative: 0.4, unknown: 0.4 } as const;

/** P(female) by group, for the fallback sex prior (structured-sex evidence, §0.1: breast 99%+ female, etc.). */
const P_FEMALE: Partial<Record<CancerGroupId, number>> = { breast: 0.99, ovarian: 1, "uterine-cervical": 1, prostate: 0 };
/**
 * Fallback answer priors for questions the catalog gives none for. Without them every definite option is
 * equally likely, so "pregnant: yes" looked 40% likely and pregnancy was asked first in breast cancer.
 * Catalog priors (config/questionnaire) always win.
 */
export const FALLBACK_PRIORS: Readonly<Record<string, (group: CancerGroupId) => Record<string, number>>> = {
  pregnancy: () => ({ yes: 0.02, no: 0.88, unknown: 0.04, prefer_not: 0.06 }),
  sex: (g) => {
    const f = P_FEMALE[g] ?? 0.5;
    return { female: 0.95 * f, male: 0.95 * (1 - f), prefer_not: 0.05 };
  },
};

/** Session resume: tab-scoped sessionStorage only (never localStorage, IndexedDB or a server). */
export const SESSION_KEY = "tb-questionnaire-v2";
/** Saved state older than this is discarded on load. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
