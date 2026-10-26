/**
 * Criteria ranking orchestration (client): resolver labels for the ranked results -> LLM judge for the unknown items of the
 * top N -> merged labels -> per-trial TrialMatchScore -> tier A / tier B order (rank.ts rankByCriteria).
 * `resolveRanking` is synchronous (no I/O) so results can show at once; `rankWithCriteria` adds the judge call.
 * The judge request carries only the minimized profile, NCT ids and criterion ids (lib/api/match.ts).
 */
import { MATCH_JUDGE } from "@/config/match-judge";
import { factsForCriterion } from "@/lib/ingest/facts";
import { findOutList } from "@/lib/questionnaire/engine";
import type { CriteriaRanking, CriterionLabel } from "@/lib/types/criteria";
import type { IntakeAnswers } from "@/lib/types/intake";
import type { MatchResponse } from "@/lib/types/match-judge";
import type { QuestionDef } from "@/lib/types/questionnaire";
import type { TrialCard } from "@/lib/types/trial";
import type { UnknownCriteria } from "@/lib/api/match";
import { normalizeMarkers, profileFromState, resolveCriteria, unresolved, type ResolverProfile } from "./criteria-resolve";
import { isScreeningItem } from "./screening";
import { orderResults, rankByCriteria, type JudgeLabels } from "./rank";

type CriteriaCard = Pick<TrialCard, "id" | "groups" | "conditions" | "criteria" | "criteriaVersion">;
type Entry = { card: CriteriaCard };

/** A real model answered (not the mock, not nobody). */
export function isRealProvider(provider: string | null | undefined): provider is string {
  return !!provider && provider !== "mock";
}

function profileOf(answers: Pick<IntakeAnswers, "questionnaire">, catalog: readonly QuestionDef[] | undefined): ResolverProfile {
  return answers.questionnaire && catalog ? profileFromState(answers.questionnaire, catalog) : { sources: {} };
}

/** Resolver labels per trial (trial id -> labels in criterion order). */
export function resolverLabels(results: readonly Entry[], answers: Pick<IntakeAnswers, "questionnaire">, catalog?: readonly QuestionDef[]): Map<string, CriterionLabel[]> {
  const profile = profileOf(answers, catalog);
  return new Map(results.map((r) => [r.card.id, resolveCriteria(r.card, profile).labels]));
}

/**
 * What the judge is asked: the top N trials that have split criteria and at least one unknown item. Items the study
 * team checks at screening (labs, consent, contraception; lib/match/screening.ts) are not sent: no answer settles them.
 */
export function judgeRequests(results: readonly Entry[], resolver: ReadonlyMap<string, readonly CriterionLabel[]>, topN: number = MATCH_JUDGE.topN): UnknownCriteria[] {
  const out: UnknownCriteria[] = [];
  for (const r of results.slice(0, topN)) {
    const screening = new Set((r.card.criteria ?? []).filter(isScreeningItem).map((c) => c.id));
    const ids = unresolved(resolver.get(r.card.id) ?? []).filter((id) => !screening.has(id));
    if (ids.length && r.card.criteriaVersion) out.push({ nctId: r.card.id, criteriaVersion: r.card.criteriaVersion, unknownIds: ids });
  }
  return out;
}

/** Fact keys a question's answers speak to (its option effects, plus `biomarker:<id>` for a biomarker grid). */
function questionKeys(q: QuestionDef): Set<string> {
  const keys = new Set<string>();
  for (const e of q.effects) for (const f of e.facts) keys.add(f.fact);
  for (const b of q.biomarkers ?? []) keys.add(`biomarker:${b}`);
  return keys;
}

/**
 * Question id -> how many unknown criterion items in these trials its fact keys appear in, for the questions the
 * Find-out list already holds (answered "not sure", skipped or deferred). Pure.
 */
export function findOutPriority(results: readonly Entry[], byTrial: CriteriaRanking["byTrial"], answers: Pick<IntakeAnswers, "questionnaire">, catalog?: readonly QuestionDef[]): Record<string, number> {
  const state = answers.questionnaire;
  if (!state || !catalog) return {};
  const gaps = findOutList(state, catalog).map((e) => e.question);
  if (gaps.length === 0) return {};
  const byKey = new Map<string, string[]>();
  for (const q of catalog) {
    if (!gaps.includes(q.id)) continue;
    for (const k of questionKeys(q)) byKey.set(k, [...(byKey.get(k) ?? []), q.id]);
  }
  const out: Record<string, number> = {};
  for (const r of results) {
    const unknown = new Set((byTrial[r.card.id]?.labels ?? []).filter((l) => l.label === "unknown").map((l) => l.id));
    for (const item of r.card.criteria ?? []) {
      if (!unknown.has(item.id)) continue;
      const facts = factsForCriterion(item.section, normalizeMarkers(item.text), { v2: true, groups: r.card.groups, ...(r.card.conditions ? { conditions: r.card.conditions } : {}) });
      const qs = new Set(facts.filter((f) => f.value !== "mentioned").flatMap((f) => byKey.get(f.key) ?? []));
      for (const q of qs) out[q] = (out[q] ?? 0) + 1;
    }
  }
  return out;
}

/** Sort Find-out entries by `priority` (highest first); ties keep the list's own order. Returns a new array. */
export function prioritizeFindOut<T extends { question: string }>(entries: readonly T[], priority: Readonly<Record<string, number>>): T[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (priority[b.e.question] ?? 0) - (priority[a.e.question] ?? 0) || a.i - b.i)
    .map((x) => x.e);
}

function build(results: readonly Entry[], resolver: ReadonlyMap<string, readonly CriterionLabel[]>, judge: JudgeLabels | null, answers: Pick<IntakeAnswers, "questionnaire">, catalog: readonly QuestionDef[] | undefined, head: Pick<CriteriaRanking, "status" | "degraded" | "provider" | "degradedReason">): CriteriaRanking {
  const { order, byTrial } = rankByCriteria(results, resolver, judge);
  return { ...head, order, byTrial, findOutPriority: findOutPriority(results, byTrial, answers, catalog) };
}

/** Resolver-only ranking, available at once. status "pending" (the judge has not answered yet), degraded true. */
export function resolveRanking(results: readonly Entry[], answers: Pick<IntakeAnswers, "questionnaire">, catalog?: readonly QuestionDef[]): CriteriaRanking {
  const resolver = resolverLabels(results, answers, catalog);
  const pending = judgeRequests(results, resolver).length > 0;
  return build(results, resolver, null, answers, catalog, { status: pending ? "pending" : "ok", degraded: pending, provider: null });
}

/** Ranking from resolver labels plus a judge response (null = no judge call was needed). Pure. */
export function rankingFromJudge(results: readonly Entry[], resolver: ReadonlyMap<string, readonly CriterionLabel[]>, response: MatchResponse | null, answers: Pick<IntakeAnswers, "questionnaire">, catalog?: readonly QuestionDef[]): CriteriaRanking {
  if (!response) return build(results, resolver, null, answers, catalog, { status: "ok", degraded: false, provider: null });
  const real = response.status === "ok" && isRealProvider(response.provider);
  const head: Pick<CriteriaRanking, "status" | "degraded" | "provider" | "degradedReason"> = real
    ? { status: "ok", degraded: false, provider: response.provider }
    : { status: "degraded", degraded: true, provider: response.provider, ...(response.degradedReason ? { degradedReason: response.degradedReason } : {}) };
  return build(results, resolver, { results: response.results, real }, answers, catalog, head);
}

interface RankWithCriteriaOptions {
  catalog?: readonly QuestionDef[];
  /** The judge call (default: lib/api/match.ts requestCriteriaJudgement); injected in tests. */
  judge: (answers: IntakeAnswers, trials: readonly UnknownCriteria[]) => Promise<MatchResponse>;
  /** Told which provider actually answered (null = none, resolver-only). */
  log?: (e: { provider: string | null; status: CriteriaRanking["status"]; degradedReason?: string; judged: number }) => void;
  /** Aborting rethrows (a newer search replaced this one); every other judge failure degrades. */
  signal?: AbortSignal;
}

/**
 * Full ranking: resolver labels for every result, the judge for the unknown items of the top N, then tiers.
 * Never throws for judge failures (falls back to resolver-only, degraded). Returns the ranking and the results
 * reordered to it.
 */
export async function rankWithCriteria<T extends Entry>(results: readonly T[], answers: IntakeAnswers, opts: RankWithCriteriaOptions): Promise<{ ranking: CriteriaRanking; results: T[] }> {
  const resolver = resolverLabels(results, answers, opts.catalog);
  const wanted = judgeRequests(results, resolver);
  let response: MatchResponse | null = null;
  if (wanted.length) {
    try {
      response = await opts.judge(answers, wanted);
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      response = { status: "degraded", provider: null, results: [], cachedIds: [], skippedIds: [], degradedReason: "ai_unavailable" };
    }
  }
  const ranking = rankingFromJudge(results, resolver, response, answers, opts.catalog);
  opts.log?.({ provider: ranking.provider, status: ranking.status, ...(ranking.degradedReason ? { degradedReason: ranking.degradedReason } : {}), judged: wanted.length });
  return { ranking, results: orderResults(results, ranking.order) };
}
