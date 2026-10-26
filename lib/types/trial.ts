import { z } from "zod";

// No eval/new Function: our CSP (and Cloudflare Workers) disallow it; zod's JIT probe would trigger
// a CSP violation report. Every schema module imports this file, so this runs before any parse.
z.config({ jitless: true });
import { CANCER_GROUP_IDS } from "@/config/cancer-groups";
import { BIOMARKER_IDS } from "@/config/biomarkers";

/** Shared trial data model: produced by ingestion (scripts/ingest), consumed by the browser and the backend. */

export const CancerGroupIdSchema = z.enum(CANCER_GROUP_IDS);
export const BiomarkerIdSchema = z.enum(BIOMARKER_IDS);

export const CriterionSectionSchema = z.enum(["inclusion", "exclusion"]);
export type CriterionSection = z.infer<typeof CriterionSectionSchema>;

/** One numbered eligibility criterion; `text` is the official English text, verbatim. */
export const CriterionSchema = z.object({ n: z.number().int().positive(), text: z.string().min(1) });
export type Criterion = z.infer<typeof CriterionSchema>;

/**
 * Split criterion (lib/ingest/criteria-split.ts, criteriaVersion 1): one atomic-as-written item with a stable id
 * (I1..In / E1..En), verbatim whitespace-normalized text and an optional cohort/arm/part scope.
 */
export const SplitCriterionSchema = z.object({
  id: z.string().regex(/^[IE][1-9]\d*$/),
  section: CriterionSectionSchema,
  text: z.string().min(1),
  scope: z.string().min(1).optional(),
});
export type SplitCriterionRecord = z.infer<typeof SplitCriterionSchema>;

export const CriterionRefSchema = z.object({ section: CriterionSectionSchema, n: z.number().int().positive() });
export type CriterionRef = z.infer<typeof CriterionRefSchema>;

export const BarrierTypeSchema = z.enum(["english_required", "upper_age_limit", "disability_exclusion"]);
export type BarrierType = z.infer<typeof BarrierTypeSchema>;

/** An access barrier with the exact sentence that triggered it. */
export const BarrierSchema = z.object({
  type: BarrierTypeSchema,
  /** Exact triggering sentence from the trial text (or the structured age field, e.g. "Maximum age: 70 Years"). */
  quote: z.string().min(1),
  ref: CriterionRefSchema.optional(),
});
export type Barrier = z.infer<typeof BarrierSchema>;

/** Eligibility fact keys extracted from criteria. Biomarkers use "biomarker:<ID>". */
export const BASE_FACT_KEYS = [
  "prior_chemotherapy",
  "prior_radiation",
  "prior_surgery",
  "prior_immunotherapy",
  "prior_targeted_therapy",
  "metastatic",
  "newly_diagnosed",
  "previously_treated",
  "pregnancy",
  "concurrent_trial",
  // Catalog fact families (QUESTIONNAIRE_SPEC §1.4). Thresholds live in Fact.param.
  "ecog_max", // param: highest ECOG allowed (number)
  "brain_mets", // param "active_only": only active/untreated brain metastases are excluded
  "measurable_disease",
  "min_prior_lines", // param: minimum number of prior lines (number)
  "max_prior_lines", // param: maximum number of prior lines (number)
  "recurrent",
  "locally_advanced",
  "adjuvant_setting",
  "castration_resistant",
  "platinum_resistant",
  "platinum_sensitive",
  "mibc",
  "resectable",
  "rai_refractory",
  "other_malignancy", // param: carve-out years (number), e.g. 2 = "unless treated more than 2 years ago"
  "hiv", // param "uncontrolled_only": only uncontrolled HIV is excluded
  "hepatitis_b",
  "hepatitis_c",
  "organ_transplant",
  "allo_sct",
  "autoimmune",
  "kidney_disease",
  "liver_disease",
  "heart_disease",
] as const;

/** Closed-vocabulary id used in template fact keys (histology:<id>, prior_drug:<id>); the id lists live in config. */
const FactIdSegmentSchema = z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
export const FactKeySchema = z.union([
  z.enum(BASE_FACT_KEYS),
  z.templateLiteral(["biomarker:", BiomarkerIdSchema]),
  z.templateLiteral(["histology:", FactIdSegmentSchema]),
  z.templateLiteral(["prior_drug:", FactIdSegmentSchema]),
]);
export type FactKey = z.infer<typeof FactKeySchema>;

/** required = must be present to join; excluded = presence rules you out; mentioned = referenced, direction unclear. */
export const FactValueSchema = z.enum(["required", "excluded", "mentioned"]);
export type FactValue = z.infer<typeof FactValueSchema>;

export const FactParamSchema = z.union([z.number(), z.string()]);
export type FactParam = z.infer<typeof FactParamSchema>;

/**
 * Time-window / limited-scope params on excluded facts: "window", "limited", or "within_<n>_<unit>" (e.g. washout
 * "within_28_days"). Such exclusions only apply inside the window, so they never act as a blanket exclusion. Numbers
 * (thresholds, carve-out years) and "active_only" / "uncontrolled_only" are not scoped in this sense.
 */
const SCOPED_PARAM_RE = /^(?:window|limited|within_\d+_(?:day|week|month|year)s?)$/;
export const isScopedParam = (p: FactParam | undefined): boolean => typeof p === "string" && SCOPED_PARAM_RE.test(p);

export const FactSchema = z.object({
  key: FactKeySchema,
  value: FactValueSchema,
  /** Verbatim criterion text the fact came from. */
  quote: z.string().min(1),
  ref: CriterionRefSchema,
  source: z.enum(["rule", "llm"]),
  /** 0..1, LLM layer only. */
  confidence: z.number().min(0).max(1).optional(),
  /** True when rule and LLM layers disagree on this key. */
  needsReview: z.boolean().optional(),
  /** Threshold or carve-out for parameterized keys (ecog_max 1, min_prior_lines 2, brain_mets "active_only"). */
  param: FactParamSchema.optional(),
});
export type Fact = z.infer<typeof FactSchema>;


export const ContactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

/** A U.S. trial site. lat/lon come from ClinicalTrials.gov geoPoint when present. */
export const SiteSchema = z.object({
  facility: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  status: z.string().optional(),
});
export type Site = z.infer<typeof SiteSchema>;

/** Everything about a trial except its sites (sites live in a separate per-shard file). */
export const TrialCardSchema = z.object({
  id: z.string().regex(/^NCT\d{8}$/),
  title: z.string(),
  officialTitle: z.string().optional(),
  summary: z.string(),
  phases: z.array(z.string()),
  conditions: z.array(z.string()),
  meshTerms: z.array(z.string()),
  groups: z.array(CancerGroupIdSchema).min(1),
  sponsor: z.string(),
  /** Years; null = no limit stated. */
  minAge: z.number().nullable(),
  maxAge: z.number().nullable(),
  sex: z.enum(["ALL", "FEMALE", "MALE"]),
  inclusion: z.array(CriterionSchema),
  exclusion: z.array(CriterionSchema),
  /** v6 split criteria (optional so pre-v6 data still loads); `criteriaVersion` names the splitter version. */
  criteria: z.array(SplitCriterionSchema).optional(),
  criteriaVersion: z.number().int().positive().optional(),
  contacts: z.array(ContactSchema),
  barriers: z.array(BarrierSchema),
  facts: z.array(FactSchema),
  siteCount: z.number().int().nonnegative(),
  states: z.array(z.string()),
  lastUpdated: z.string(),
});
export type TrialCard = z.infer<typeof TrialCardSchema>;

/** Per-shard sites file: NCT ID -> U.S. sites. */
export const ShardSitesSchema = z.record(z.string(), z.array(SiteSchema));
export type ShardSites = z.infer<typeof ShardSitesSchema>;

export const ShardInfoSchema = z.object({
  id: z.string(),
  group: CancerGroupIdSchema,
  /** full = TrialCard[] + Site[]; lite = cross-group "not sure" index (LiteCard[] + coordinates only). */
  kind: z.enum(["full", "lite"]),
  count: z.number().int(),
  /** File names relative to `${manifest.shardBase}/<id>/` */
  files: z.object({ cards: z.string(), sites: z.string(), index: z.string(), embeddings: z.string() }),
  bytes: z.number().int(),
});
export type ShardInfo = z.infer<typeof ShardInfoSchema>;

/** /data/manifest.json: how groups map to shard parts, plus embedding format. */
export const ManifestSchema = z.object({
  dataVersion: z.string(),
  /** Versioned base path for shard files (e.g. /data/shards/<dataVersion>), so they can be cached immutably. */
  shardBase: z.string().startsWith("/data/"),
  embedding: z.object({ model: z.string(), dims: z.number().int(), quantization: z.literal("int8"), scale: z.number() }),
  groups: z.partialRecord(CancerGroupIdSchema, z.array(z.string())),
  shards: z.array(ShardInfoSchema),
  /** Cross-group lite index for "not sure": a shard id containing every trial (kind "lite"). */
  allShard: z.string(),
  /** Per-trial buckets: `${trialBase}/<last 3 digits of NCT ID>.json` (TrialBucket). */
  trialBase: z.string().startsWith("/data/"),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** /data/meta.json */
export const MetaSchema = z.object({
  dataDate: z.string(),
  dataVersion: z.string(),
  source: z.enum(["seed", "national"]),
  totalTrials: z.number().int(),
  countsByGroup: z.partialRecord(CancerGroupIdSchema, z.number().int()),
  statesCovered: z.number().int(),
  embeddingModel: z.string(),
  llmModel: z.string().nullable(),
  pipelineVersion: z.string(),
  promptVersion: z.string(),
});
export type Meta = z.infer<typeof MetaSchema>;

/** Lite card for the cross-group "not sure" index: just what hard filters, ranking, and pre-check need. */
export const LiteCardSchema = z.object({
  id: z.string().regex(/^NCT\d{8}$/),
  title: z.string(),
  conditions: z.array(z.string()),
  groups: z.array(CancerGroupIdSchema).min(1),
  minAge: z.number().nullable(),
  maxAge: z.number().nullable(),
  /** Facts as [key, value, param?] (quotes omitted; full cards are loaded for the final top results). */
  f: z.array(z.union([z.tuple([FactKeySchema, FactValueSchema]), z.tuple([FactKeySchema, FactValueSchema, FactParamSchema])])),
  /** Structured sex restriction; absent = ALL (used by the definite-sex hard filter). */
  s: z.enum(["FEMALE", "MALE"]).optional(),
  /** Barrier types present. */
  b: z.array(BarrierTypeSchema),
});
export type LiteCard = z.infer<typeof LiteCardSchema>;

/** Lite sites: NCT ID -> [lat, lon] pairs (sites without coordinates omitted). */
export const LiteSitesSchema = z.record(z.string(), z.array(z.tuple([z.number(), z.number()])));

/** Per-trial bucket file: NCT ID -> full card + sites (trial detail page, "not sure" top results). */
export const TrialBucketSchema = z.record(z.string(), z.object({ card: TrialCardSchema, sites: z.array(SiteSchema) }));
export type TrialBucket = z.infer<typeof TrialBucketSchema>;

/** Bucket key for an NCT ID (last 3 digits). */
export const trialBucketKey = (nctId: string): string => nctId.slice(-3);
