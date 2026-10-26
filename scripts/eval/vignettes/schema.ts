/**
 * Vignette benchmark schema (eval/gold/vignettes-v1.json): synthetic patients with structured questionnaire answers
 * and a short free-text description. Shared by the validator, the pooling/judging scripts and the eval runner.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { CANCER_GROUP_IDS } from "../../../config/cancer-groups";
import { getCatalog } from "../../../config/questionnaire";
import type { AnswerValue, QuestionnaireState } from "../../../lib/types/questionnaire";

export const VignetteSchema = z.strictObject({
  id: z.string().regex(/^v\d{3}$/),
  group: z.enum(CANCER_GROUP_IDS),
  /** Stratification labels (free strings; reported, never used for matching). */
  strata: z.strictObject({ subtype: z.string(), stage: z.string(), line: z.string(), biomarker: z.string() }),
  age: z.number().int().min(18).max(110),
  sex: z.enum(["female", "male"]),
  zip: z.string().regex(/^\d{5}$/),
  /** Miles, or "anywhere". */
  travel: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(250), z.literal(500), z.literal("anywhere")]),
  /** Non-essential questionnaire answers by question id (option ids as in the catalog). */
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])),
  /** 3-6 sentences in the patient's or caregiver's voice. No names, no real people. */
  freeText: z.string().min(80).max(1200),
});
export type Vignette = z.infer<typeof VignetteSchema>;

export const VignetteFileSchema = z.strictObject({
  schema: z.literal(1),
  note: z.string(),
  vignettes: z.array(VignetteSchema),
});
export type VignetteFile = z.infer<typeof VignetteFileSchema>;

/** Frozen dev/test split: sha1 of the id, first byte parity. Deterministic, author-independent. */
export function splitOf(id: string): "dev" | "test" {
  const b = createHash("sha1").update(id).digest()[0] as number;
  return b % 2 === 0 ? "dev" : "test";
}

/** Problems with one vignette against its group's catalog (option ids, prerequisites, sex/group sanity). [] = ok. */
export function vignetteProblems(v: Vignette): string[] {
  const problems: string[] = [];
  const catalog = getCatalog("cancer", v.group);
  const byId = new Map(catalog.map((q) => [q.id as string, q]));
  const essentials: Record<string, AnswerValue> = { cancer_type: v.group, age: v.age, zip: v.zip, travel: v.travel === "anywhere" ? null : v.travel };
  const all: Record<string, AnswerValue> = { ...essentials, ...v.answers, sex: v.sex };
  for (const [id, val] of Object.entries(v.answers)) {
    const q = byId.get(id);
    if (!q) {
      problems.push(`unknown question ${id} for ${v.group}`);
      continue;
    }
    if (q.tier === "essential") problems.push(`${id} is an essential (use the top-level field)`);
    const ids = new Set((q.options ?? []).map((o) => o.id));
    if (q.type === "single") {
      if (typeof val !== "string" || !ids.has(val)) problems.push(`${id}: bad option ${JSON.stringify(val)}`);
    } else if (q.type === "multi") {
      if (!Array.isArray(val) || val.length === 0 || val.some((x) => !ids.has(x))) problems.push(`${id}: bad options ${JSON.stringify(val)}`);
    } else if (q.type === "biomarker_grid") {
      const allowed = new Set<string>(q.biomarkers ?? []);
      if (typeof val !== "object" || Array.isArray(val)) problems.push(`${id}: grid must be an object`);
      else for (const [m, s] of Object.entries(val)) if (!allowed.has(m) || !["positive", "negative", "not_tested", "unknown"].includes(s)) problems.push(`${id}: bad grid entry ${m}=${s}`);
    }
    // Prerequisites (and maxAge) must hold given the other answers.
    if (q.maxAge !== undefined && v.age > q.maxAge) problems.push(`${id}: not asked above age ${q.maxAge}`);
    for (const p of q.prerequisites ?? []) {
      const pv = all[p.question];
      const pids = pv === null || pv === undefined ? ["unknown"] : typeof pv === "number" ? [String(pv)] : typeof pv === "string" ? [pv] : Array.isArray(pv) ? pv : ["*"];
      const hit = p.anyOf.includes("*") || pids.some((x) => p.anyOf.includes(x));
      if (p.negate ? hit : !hit && pv !== undefined) problems.push(`${id}: prerequisite on ${p.question} fails`);
    }
  }
  if (v.group === "prostate" && v.sex !== "male") problems.push("prostate vignette must be male");
  if ((v.group === "ovarian" || v.group === "uterine-cervical") && v.sex !== "female") problems.push(`${v.group} vignette must be female`);
  if (/\b(Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z]/.test(v.freeText)) problems.push("freeText must not contain names");
  return problems;
}

/** Questionnaire state for a vignette (thorough mode, every answer counted). */
export function vignetteState(v: Vignette): QuestionnaireState {
  const answers: Record<string, AnswerValue> = { cancer_type: v.group, age: v.age, zip: v.zip, travel: v.travel === "anywhere" ? null : v.travel, sex: v.sex, ...v.answers };
  return { v: 2, area: "cancer", mode: "thorough", answers, history: Object.keys(answers), deferred: [], updatedAt: 1 };
}
