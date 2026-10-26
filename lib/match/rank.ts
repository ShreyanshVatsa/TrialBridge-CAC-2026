import type { LatLon } from "@/lib/geo/distance";
import type { IntakeAnswers } from "@/lib/types/intake";
import type { Site, TrialCard } from "@/lib/types/trial";
import type { RankedTrial, SearchOutcome } from "@/lib/types/match";
import { cosineSimilarity } from "./cosine";
import type { FactPolicyMap, QuestionDef } from "@/lib/types/questionnaire";
import type { PrecheckNote } from "@/lib/types/match";
import { compileState, hardFilters } from "@/lib/questionnaire/rules";
import { nearestSite, passesAge, passesDistance, passesGroup, passesSex } from "./filters";
import { reciprocalRankFusion, RRF_K } from "./rrf";
import { answerEvaluator, precheck, unknownCounter } from "./precheck";
import { mergeLabels, normalizeRrf, phaseBonus, precheckBonus, precheckPenalty, tierOrder, trialMatchScore } from "./score";
import type { CriterionLabel, TrialCriteriaLabels, TrialCriteriaResult } from "@/lib/types/criteria";
import { fusedScore, type Features, type FusionWeights } from "./fusion";
import { subtypeMatch, subtypeProfile, type SubtypeProfile } from "./subtype";
import { extentConflict } from "./extent";
import { getCancerGroup, type CancerGroupId } from "@/config/cancer-groups";

/**
 * How many results are kept and re-ranked by the deterministic resolver (the UI shows 10, then "show more"). 15 until
 * v9; 20 measured better on both dev sets (TREC dev resolver nDCG@10 0.545 -> 0.561; vignette dev excluded share in the
 * top 10 -0.06, condensed nDCG +0.03; 30 was no better). Related
 * limits: the LLM judge reads only the top `MATCH_JUDGE.topN` of these (config/match-judge.ts), and the vignette eval
 * stores the top `STORED_K` = 50 per system (scripts/eval/vignettes/pool.ts).
 */
export const TOP_N = 20;

export interface RankEntry {
  card: TrialCard;
  sites: Site[];
  /** The trial's stored (int8) embedding. */
  vector: ArrayLike<number>;
}

export type RankAnswers = Pick<IntakeAnswers, "cancerType" | "age" | "travelMiles" | "language" | "spread" | "treatments" | "biomarkers" | "pregnant" | "inAnotherTrial" | "questionnaire">;

/** Questionnaire matching context: the catalog (and fact policy) that give answers their meaning. */
export interface MatchContext {
  catalog?: readonly QuestionDef[];
  policy?: FactPolicyMap;
}

/**
 * Pre-check for either intake, prepared once per search: the questionnaire (catalog-driven, answers compiled a
 * single time, plus the phase preference) when a questionnaire state and catalog are present, else the legacy
 * fixed-flow `precheck`. Also returns the definite-sex hard filter (null = no filter), read from the same
 * compiled answers.
 */
type MatchCard = Pick<TrialCard, "facts" | "phases"> & Partial<Pick<TrialCard, "conditions" | "title" | "officialTitle">>;
interface PrecheckResult {
  notes: PrecheckNote[];
  phase: number;
  /** Structured subtype match against the trial's registered conditions: 1 match, -1 conflict, 0 neutral. */
  subtype: -1 | 0 | 1;
  /** 1 when the trial's own stated extent contradicts the definite `spread` answer (extent.ts). */
  extent: 0 | 1;
  /** Directional criteria the answers say nothing about (see unknownCounter); undefined for the legacy intake. */
  unknowns?: number;
}

function prepareMatching(answers: RankAnswers, ctx: MatchContext = {}): { precheck: (card: MatchCard) => PrecheckResult; sex: "FEMALE" | "MALE" | null } {
  const state = answers.questionnaire;
  if (state && ctx.catalog) {
    const compiled = compileState(state, ctx.catalog);
    const check = answerEvaluator(compiled, ctx.policy);
    const unknown = unknownCounter(compiled);
    const pref = state.answers["phase_pref"];
    const prefId = typeof pref === "string" ? pref : null;
    const profile: SubtypeProfile | null = subtypeProfile(compiled, state.answers);
    const group = answers.cancerType;
    const spread = state.answers["spread"];
    return { precheck: (card) => ({ notes: check(card.facts), phase: phaseBonus(prefId, card.phases), subtype: subtypeMatch(profile, card, group), extent: extentConflict(spread, card), unknowns: unknown(card.facts) }), sex: hardFilters(compiled).sex ?? null };
  }
  return { precheck: (card) => ({ notes: precheck(answers, card.facts), phase: 0, subtype: 0, extent: 0 }), sex: null };
}

/** The fusion features of one candidate (see fusion.ts). */
export function featuresOf(r: { retrieval: number; notes: readonly PrecheckNote[]; phase: number; subtype: -1 | 0 | 1; viaBasket: boolean; weakGroup?: boolean; extent?: 0 | 1 } & Partial<Pick<Features, "kw" | "vec" | "cosine" | "bm25">>): Features {
  return {
    retrieval: r.retrieval,
    kw: r.kw ?? 0,
    vec: r.vec ?? 0,
    cosine: r.cosine ?? 0,
    bm25: r.bm25 ?? 0,
    penalty: precheckPenalty(r.notes),
    bonus: precheckBonus(r.notes),
    phase: r.phase,
    subtypeMatch: r.subtype === 1 ? 1 : 0,
    subtypeConflict: r.subtype === -1 ? 1 : 0,
    basket: r.viaBasket ? 1 : 0,
    weakGroup: r.weakGroup ? 1 : 0,
    extentConflict: r.extent ?? 0,
  };
}

/**
 * True when a condition or title of the trial names the patient's group (its text pattern matches). Trials that carry
 * the group only through MeSH ancestors or keyword browse terms ("Genetic Testing" listed under 8 cancer groups) are
 * weaker matches. Basket-only trials and "other" count as named: their own feature handles them.
 */
export function groupNamed(card: Partial<Pick<TrialCard, "conditions" | "title" | "officialTitle" | "groups">>, group: CancerGroupId): boolean {
  if (group === "other" || !card.groups?.includes(group)) return true;
  const text = [...(card.conditions ?? []), card.title ?? "", card.officialTitle ?? ""].join(" ; ");
  return getCancerGroup(group).text.some((re) => re.test(text));
}

/** True when the trial reaches the group only through the solid-tumor basket (it names no specific cancer type). */
export function reachesViaBasket(card: Pick<TrialCard, "groups">, group: CancerGroupId): boolean {
  return group !== "other" && !card.groups.includes(group);
}

/** Per-trial pre-check for either intake (see `prepareMatching`; use that when checking many trials). */
export function trialPrecheck(answers: RankAnswers, card: MatchCard, ctx: MatchContext = {}): PrecheckResult {
  return prepareMatching(answers, ctx).precheck(card);
}

/** The definite-sex hard filter from the questionnaire (null = no filter). */
export function sexFilter(answers: RankAnswers, ctx: MatchContext = {}): "FEMALE" | "MALE" | null {
  return prepareMatching(answers, ctx).sex;
}

interface RankInput extends MatchContext {
  entries: RankEntry[];
  answers: RankAnswers;
  /** User's ZIP centroid; null if unknown (distance filter is then skipped). */
  origin: LatLon | null;
  /** BM25 keyword search returning trial IDs best-first. */
  keywordSearch: (ids: ReadonlySet<string>) => string[];
  /** Optional: the same search with raw BM25 scores (when given it replaces keywordSearch). Feeds the `bm25` feature. */
  keywordScores?: (ids: ReadonlySet<string>) => Map<string, number>;
  /** Profile embedding; null => keyword-only ranking. */
  queryVector: ArrayLike<number> | null;
  limit?: number;
  /** Fusion weights (default: the shipped set); eval scripts pass candidates here. */
  weights?: FusionWeights;
  /** RRF k override (default: config/retrieval.ts); eval scripts only. */
  rrfK?: number;
}

/**
 * Pure ranking pipeline: hard filters -> BM25 + cosine rankings -> RRF -> rule pre-check -> score.
 * Hard filters are absolute: a trial failing group, age, distance, or a definite sex never appears.
 */
export function rankTrials(input: RankInput): SearchOutcome {
  const { answers, origin } = input;
  const rrfK = input.rrfK ?? RRF_K;
  const maxMiles = origin ? answers.travelMiles : null;
  const matching = prepareMatching(answers, input);
  const sex = matching.sex;

  // 1. Hard filters.
  const candidates = new Map<string, RankEntry & { nearest: ReturnType<typeof nearestSite> }>();
  for (const e of input.entries) {
    if (candidates.has(e.card.id)) continue; // a trial can appear in several shard parts
    if (!passesGroup(e.card, answers.cancerType) || !passesAge(e.card, answers.age) || !passesSex(e.card, sex)) continue;
    const nearest = nearestSite(e.sites, origin);
    if (!passesDistance(nearest, maxMiles)) continue;
    candidates.set(e.card.id, { ...e, nearest });
  }
  const ids = new Set(candidates.keys());

  // 2. Two independent rankings over the candidates.
  const bm25Raw = input.keywordScores?.(ids);
  const keywordRanking = bm25Raw
    ? [...bm25Raw.entries()].filter(([id]) => ids.has(id)).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id)
    : input.keywordSearch(ids).filter((id) => ids.has(id));
  const bm25Max = bm25Raw ? Math.max(1e-9, ...bm25Raw.values()) : 1;
  const rankings: string[][] = [keywordRanking];
  const cosines = new Map<string, number>();
  if (input.queryVector) {
    const q = input.queryVector;
    const sims = [...candidates.values()].map((c) => ({ id: c.card.id, sim: cosineSimilarity(q, c.vector) }));
    for (const x of sims) cosines.set(x.id, x.sim);
    rankings.push(sims.sort((a, b) => b.sim - a.sim || a.id.localeCompare(b.id)).map((x) => x.id));
  }

  // 3. Fuse with RRF; candidates found by neither method still appear (score 0) after the rest.
  const fused = reciprocalRankFusion(rankings, rrfK);
  const fusedIds = new Set(fused.map((f) => f.id));
  for (const id of [...ids].sort()) if (!fusedIds.has(id)) fused.push({ id, score: 0, ranks: rankings.map(() => null) });

  // 4. Pre-check (legacy rules or the questionnaire catalog) + final score.
  const ranked: RankedTrial[] = fused.map((f) => {
    const c = candidates.get(f.id) as RankEntry & { nearest: ReturnType<typeof nearestSite> };
    const { notes, phase, subtype, extent, unknowns } = matching.precheck(c.card);
    const retrieval = normalizeRrf(f.score, rankings.length, rrfK);
    const features = featuresOf({
      retrieval,
      notes,
      phase,
      subtype,
      extent,
      viaBasket: reachesViaBasket(c.card, answers.cancerType),
      weakGroup: !groupNamed(c.card, answers.cancerType),
      kw: f.ranks[0] ? (rrfK + 1) / (rrfK + f.ranks[0]) : 0,
      vec: f.ranks[1] ? (rrfK + 1) / (rrfK + f.ranks[1]) : 0,
      cosine: Math.max(0, cosines.get(f.id) ?? 0),
      bm25: bm25Raw ? (bm25Raw.get(f.id) ?? 0) / bm25Max : 0,
    });
    return {
      card: c.card,
      sites: c.sites,
      nearest: c.nearest,
      languageWarning: answers.language !== "en" && c.card.barriers.some((b) => b.type === "english_required"),
      precheck: notes,
      scores: {
        keywordRank: f.ranks[0] ?? null,
        vectorRank: f.ranks[1] ?? null,
        rrf: f.score,
        retrieval,
        precheckPenalty: features.penalty,
        fit: null,
        phaseBonus: phase,
        features,
        ...(unknowns !== undefined ? { unknowns } : {}),
        final: fusedScore(features, null, input.weights),
      },
      analysis: null,
    };
  });
  ranked.sort((a, b) => b.scores.final - a.scores.final || b.scores.rrf - a.scores.rrf || a.card.id.localeCompare(b.card.id));

  return {
    results: ranked.slice(0, input.limit ?? TOP_N),
    candidateCount: candidates.size,
    searchedCount: new Set(input.entries.map((e) => e.card.id)).size,
    keywordOnly: !input.queryVector,
  };
}

// ---------------------------------------------------------------------------------------------
// Criteria tiers. Re-ranks results that rankTrials already ordered (that order is the retrieval rank).
// ---------------------------------------------------------------------------------------------

/** What the LLM judge returned, as rankByCriteria needs it. `real` = a real (non-mock) provider answered. */
export interface JudgeLabels {
  results: readonly TrialCriteriaLabels[];
  real: boolean;
}

/**
 * Score and tier results from per-criterion labels. `results` is in retrieval order (rank 1 first). LLM labels are
 * used only from a real provider and only when their criteriaVersion matches the card's; they fill only ids the
 * resolver left unknown (mergeLabels). A trial is `degraded` when it had unknown items and no real LLM labels.
 * Pure.
 */
export function rankByCriteria(
  results: readonly { card: Pick<TrialCard, "id" | "criteriaVersion"> }[],
  resolver: ReadonlyMap<string, readonly CriterionLabel[]>,
  judge: JudgeLabels | null,
): { order: string[]; byTrial: Record<string, TrialCriteriaResult> } {
  const llm = new Map((judge?.real ? judge.results : []).map((r) => [r.trialId, r]));
  const byTrial: Record<string, TrialCriteriaResult> = {};
  const scores = results.map((r, i) => {
    const own = resolver.get(r.card.id) ?? [];
    const j = llm.get(r.card.id);
    const usable = j && j.criteriaVersion === (r.card.criteriaVersion ?? 0) ? j : undefined;
    const labels = mergeLabels(own, usable?.labels);
    const degraded = own.some((l) => l.label === "unknown") && !usable;
    const score = trialMatchScore(r.card.id, labels, i + 1, degraded);
    byTrial[r.card.id] = { score, labels };
    return score;
  });
  // With a real judge, trials it could check come before trials it never saw (retrieval rank past its top N): an
  // unchecked trial's unknowns would otherwise let it outrank a fully checked one. Tier B still goes last.
  const ordered = tierOrder(scores);
  const checkedFirst = judge?.real ? [...ordered].sort((a, b) => (a.tier === b.tier ? Number(a.degraded) - Number(b.degraded) : 0)) : ordered;
  return { order: checkedFirst.map((s) => s.trialId), byTrial };
}

/** Reorder results to `order` (ids missing from it keep their relative order, after the rest). Returns a new array. */
export function orderResults<T extends { card: { id: string } }>(results: readonly T[], order: readonly string[]): T[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (pos.get(a.r.card.id) ?? order.length + a.i) - (pos.get(b.r.card.id) ?? order.length + b.i))
    .map((x) => x.r);
}
