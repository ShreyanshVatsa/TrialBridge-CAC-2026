/**
 * Catalog validation (QUESTIONNAIRE_SPEC §1.2): a zod schema plus a refinement over the whole catalog.
 * Unit-tested; also usable at build time. Returns human-readable problems (empty = valid).
 */
import { z } from "zod";
import { FactKeySchema } from "@/lib/types/trial";
import { FACT_FAMILIES } from "@/lib/ingest/eligibility-facts";
import { GROUP_STATUS_IDS, QUESTION_IDS, SUBTYPE_IDS } from "./ids";
import { QUESTIONNAIRE_EN_ALL } from "./en-defaults";
import { FIND_OUT_ITEMS, findOutId } from "./find-out";
import { DEFERRED, NON_RESPONSE_IDS, PREFER_NOT, SKIP, UNKNOWN, type QuestionDef } from "./types";

const Relation = z.enum(["conflict", "support", "neutral"]);
const FactRuleSchema = z.strictObject({
  fact: FactKeySchema,
  whenRequired: Relation.optional(),
  whenExcluded: Relation.optional(),
  paramCompare: z.strictObject({ op: z.enum(["lte", "gte"]), value: z.number(), else: Relation }).optional(),
  paramIn: z.array(z.string()).optional(),
});
const EffectSchema = z.strictObject({
  option: z.string().min(1),
  facts: z.array(FactRuleSchema),
  queryTerms: z.array(z.string()).optional(),
  hardFilter: z.strictObject({ sex: z.enum(["FEMALE", "MALE"]).optional() }).optional(),
});
const KeySchema = z.string().regex(/^(questionnaire|findOut)\.[a-z0-9_.-]+$/i);

const QuestionDefSchema = z
  .strictObject({
    id: z.enum(QUESTION_IDS),
    area: z.literal("cancer"),
    tier: z.enum(["essential", "helpful", "deep"]),
    type: z.enum(["group_picker", "age", "zip", "travel", "single", "multi", "biomarker_grid"]),
    labelKey: KeySchema,
    helpKey: KeySchema,
    whyKey: KeySchema,
    findOutKey: KeySchema.optional(),
    options: z.array(z.strictObject({ id: z.string().min(1), labelKey: KeySchema, helpKey: KeySchema.optional(), exclusiveWith: z.array(z.string()).optional() })).optional(),
    biomarkers: z.array(z.string()).optional(),
    appliesTo: z.union([z.literal("all"), z.array(z.string()).min(1)]),
    excludeGroups: z.array(z.string()).optional(),
    prerequisites: z.array(z.strictObject({ question: z.enum(QUESTION_IDS), anyOf: z.array(z.string()), negate: z.boolean().optional() })).optional(),
    cost: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    sensitive: z.boolean().optional(),
    effects: z.array(EffectSchema),
    aiField: z.string().optional(),
    priors: z.record(z.string(), z.record(z.string(), z.number().min(0).max(1))).optional(),
    enabled: z.boolean(),
    disabledReason: z.string().min(1).optional(),
    evidence: z.string().min(1),
    families: z.array(z.string()),
    legacyFacts: z.boolean().optional(),
    maxAge: z.number().int().positive().optional(),
  })
  // Non-response options never carry facts, query terms or hard filters.
  .refine((q) => q.effects.filter((e) => NON_RESPONSE_IDS.includes(e.option) || e.option.endsWith(`:${UNKNOWN}`) || e.option.endsWith(`:${SKIP}`)).every((e) => e.facts.length === 0 && !e.queryTerms?.length && !e.hardFilter), {
    message: "non-response options (unknown, prefer_not, __skip, deferred) must have no facts, query terms or hard filters",
  })
  .refine((q) => q.enabled === (q.disabledReason === undefined), { message: "disabledReason is required exactly when enabled is false" });

/** Every problem with a catalog (one group's ordered questions). Empty array = valid. */
export function validateCatalog(catalog: readonly QuestionDef[], messages: Readonly<Record<string, string>> = QUESTIONNAIRE_EN_ALL): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const families = new Set(Object.keys(FACT_FAMILIES));
  for (const q of catalog) {
    const where = `${q.id}`;
    const parsed = QuestionDefSchema.safeParse(q);
    if (!parsed.success) problems.push(...parsed.error.issues.map((i) => `${where}: ${i.path.join(".")} ${i.message}`));
    if (seen.has(q.id)) problems.push(`${where}: duplicate question id`);
    // Prerequisites must reference earlier questions (which also rules out cycles).
    for (const p of q.prerequisites ?? []) if (!seen.has(p.question)) problems.push(`${where}: prerequisite ${p.question} is not an earlier question`);
    seen.add(q.id);
    for (const f of q.families) if (!families.has(f)) problems.push(`${where}: unknown fact family ${f}`);
    const keys = [q.labelKey, q.helpKey, q.whyKey, ...(q.options ?? []).map((o) => o.labelKey)];
    if (q.findOutKey) {
      const item = FIND_OUT_ITEMS[findOutId(q.findOutKey)];
      if (!item) problems.push(`${where}: no find-out item for ${q.findOutKey}`);
      else keys.push(item.whatKey, item.whereKey, item.whyKey);
    }
    for (const k of keys) if (messages[k] === undefined) problems.push(`${where}: missing English message ${k}`);
    if (q.tier === "essential") continue;
    const ids = (q.options ?? []).map((o) => o.id);
    if (!ids.includes(UNKNOWN) || !ids.includes(SKIP)) problems.push(`${where}: helpful/deep questions need "unknown" and "__skip"`);
    if (q.sensitive && !ids.includes(PREFER_NOT)) problems.push(`${where}: sensitive questions need "prefer_not"`);
    if (q.id === "subtype") for (const id of ids) if (!NON_RESPONSE_IDS.includes(id) && !(SUBTYPE_IDS as readonly string[]).includes(id)) problems.push(`${where}: ${id} is not a SubtypeId`);
    if (q.id === "group_status") for (const id of ids) if (!NON_RESPONSE_IDS.includes(id) && !(GROUP_STATUS_IDS as readonly string[]).includes(id)) problems.push(`${where}: ${id} is not a GroupStatusId`);
    const effectIds = new Set(q.effects.map((e) => e.option));
    if (q.type === "biomarker_grid") {
      for (const b of q.biomarkers ?? []) for (const s of ["positive", "negative", "not_tested", UNKNOWN, SKIP]) if (!effectIds.has(`${b}:${s}`)) problems.push(`${where}: no effect for ${b}:${s}`);
      for (const id of ids) if (!["positive", "negative", "not_tested"].includes(id) && !effectIds.has(id)) problems.push(`${where}: option ${id} has no effect`);
    } else {
      for (const id of ids) if (!effectIds.has(id)) problems.push(`${where}: option ${id} has no effect`);
      for (const id of effectIds) if (!ids.includes(id)) problems.push(`${where}: effect for unknown option ${id}`);
    }
    for (const [g, table] of Object.entries(q.priors ?? {})) {
      const sum = Object.values(table).reduce((s, v) => s + v, 0);
      if (Math.abs(sum - 1) > 0.01) problems.push(`${where}: priors for ${g} sum to ${sum.toFixed(3)}`);
    }
    if (ids.includes(DEFERRED) && q.cost !== 3 && q.cost !== 2) problems.push(`${where}: "deferred" is for questions that usually need a report`);
  }
  return problems;
}
