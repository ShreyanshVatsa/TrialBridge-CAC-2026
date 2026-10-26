/**
 * Engine adapter for the questionnaire UI. Components import engine and catalog functions
 * only from here. The engine is lib/questionnaire; the catalog, find-out items and fact policy come from
 * config/questionnaire via ./catalog-source. This file only binds them (policy and items are passed in).
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import * as engine from "@/lib/questionnaire/engine";
import type { CandidatePool, NextStep } from "@/lib/questionnaire/engine";
import type { AnswerValue, FindOutEntry, QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { FACT_POLICY, getCatalog as catalogFor, getFindOutItems } from "./catalog-source";

export type { CandidatePool, NextStep };
export { clearSession, loadSession, saveSession } from "@/lib/questionnaire/engine";
export { toIntakeAnswers } from "@/lib/questionnaire/adapter";

const opts = FACT_POLICY ? { policy: FACT_POLICY } : {};

export function getCatalog(area: "cancer", group: CancerGroupId): readonly QuestionDef[] {
  return catalogFor(area, group);
}

/** Hard filters + keyword prior over the group's shard (code-split: loads only after the essentials). */
export async function buildCandidatePool(state: QuestionnaireState, o: { signal?: AbortSignal } = {}): Promise<CandidatePool> {
  const { buildCandidatePool: build } = await import("@/lib/questionnaire/pool");
  const group = (state.answers.cancer_type as CancerGroupId | undefined) ?? "other";
  return build(state, { ...o, catalog: getCatalog("cancer", group) });
}

export function nextQuestion(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]): NextStep {
  return engine.nextQuestion(state, pool, catalog, opts);
}

/**
 * Record an answer (engine.applyAnswer). When the cancer type changes, biomarker-grid answers that name
 * markers the new type's question doesn't ask are dropped too, so stale results never carry over.
 */
export function applyAnswer(state: QuestionnaireState, q: string, value: AnswerValue, catalog: readonly QuestionDef[], o: { gain?: number } = {}) {
  const res = engine.applyAnswer(state, q, value, catalog, o);
  if (q !== "cancer_type" || state.answers.cancer_type === value || typeof value !== "string") return res;
  const nextCatalog = getCatalog("cancer", value as CancerGroupId);
  let next = res.state;
  const dropped = [...res.dropped];
  for (const def of nextCatalog) {
    const v = next.answers[def.id];
    if (def.type !== "biomarker_grid" || !v || typeof v !== "object" || Array.isArray(v)) continue;
    const asked = new Set<string>(def.biomarkers ?? []);
    if (Object.keys(v).every((m) => asked.has(m))) continue;
    const answers = { ...next.answers };
    delete answers[def.id];
    next = { ...next, answers, history: next.history.filter((h) => h !== def.id), deferred: next.deferred.filter((d) => d !== def.id) };
    dropped.push(def.id);
  }
  return { state: next, dropped };
}

export function liveCount(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]) {
  return engine.liveCount(state, pool, catalog, opts);
}

export function estimateRemaining(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]): number {
  return engine.estimateRemaining(state, pool, catalog, opts);
}

export function remainingOptional(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]): number {
  return engine.remainingOptional(state, pool, catalog);
}

export function findOutList(state: QuestionnaireState, catalog: readonly QuestionDef[]): FindOutEntry[] {
  return engine.findOutList(state, catalog, getFindOutItems());
}

/** Extra searchTrials options so ranking uses the catalog-driven pre-check (spec §3). */
export function matchOptions(group: CancerGroupId): { catalog: readonly QuestionDef[]; policy?: NonNullable<typeof FACT_POLICY> } {
  return { catalog: getCatalog("cancer", group), ...(FACT_POLICY ? { policy: FACT_POLICY } : {}) };
}
