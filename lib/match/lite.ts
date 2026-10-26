import type { LatLon } from "@/lib/geo/distance";
import type { IntakeAnswers } from "@/lib/types/intake";
import type { LiteCard, Site, TrialCard } from "@/lib/types/trial";
import type { SearchOutcome } from "@/lib/types/match";
import { nearestSite } from "./filters";
import { fusedScore } from "./fusion";
import { featuresOf, groupNamed, reachesViaBasket, trialPrecheck, type MatchContext, type RankAnswers, type RankEntry } from "./rank";

/**
 * Cross-group "not sure" search runs over a LITE index (no criteria text/site details), then the
 * final top results are hydrated with full cards. These helpers are pure for testing.
 */

/** Expand a lite card into the TrialCard shape that the ranking pipeline reads (filters, facts, barriers). */
export function liteToCard(l: LiteCard): TrialCard {
  return {
    id: l.id,
    title: l.title,
    summary: "",
    phases: [],
    conditions: l.conditions,
    meshTerms: [],
    groups: l.groups,
    sponsor: "",
    minAge: l.minAge,
    maxAge: l.maxAge,
    sex: l.s ?? "ALL",
    inclusion: [],
    exclusion: [],
    contacts: [],
    barriers: l.b.map((type) => ({ type, quote: type })),
    facts: l.f.map(([key, value, param]) => ({ key, value, quote: key, ref: { section: "inclusion" as const, n: 1 }, source: "rule" as const, ...(param !== undefined ? { param } : {}) })),
    siteCount: 0,
    states: [],
    lastUpdated: "",
  };
}

export function liteToEntries(shard: { cards: LiteCard[]; sites: Record<string, [number, number][]>; embeddings: Int8Array }, dims: number): RankEntry[] {
  return shard.cards.map((l, i) => ({
    card: liteToCard(l),
    sites: (shard.sites[l.id] ?? []).map(([lat, lon]): Site => ({ facility: "", city: "", state: "", zip: "", lat, lon })),
    vector: shard.embeddings.subarray(i * dims, (i + 1) * dims),
  }));
}

/**
 * Replace lite results with full cards + sites, recomputing pre-check notes (now with quotes),
 * nearest site, language warning, and final score. Results whose full card is missing are dropped.
 */
export function hydrateResults(
  outcome: SearchOutcome,
  full: ReadonlyMap<string, { card: TrialCard; sites: Site[] }>,
  answers: Pick<IntakeAnswers, "cancerType" | "language" | "spread" | "treatments" | "biomarkers" | "pregnant" | "inAnotherTrial" | "questionnaire">,
  origin: LatLon | null,
  ctx: MatchContext = {},
): SearchOutcome {
  const results = outcome.results.flatMap((r) => {
    const f = full.get(r.card.id);
    if (!f) return [];
    const { notes, phase, subtype, unknowns } = trialPrecheck(answers as RankAnswers, f.card, ctx);
    const features = featuresOf({ ...(r.scores.features ? { kw: r.scores.features.kw, vec: r.scores.features.vec, cosine: r.scores.features.cosine, bm25: r.scores.features.bm25 } : {}), retrieval: r.scores.retrieval, notes, phase, subtype, viaBasket: reachesViaBasket(f.card, (answers as RankAnswers).cancerType), weakGroup: !groupNamed(f.card, (answers as RankAnswers).cancerType) });
    return [
      {
        ...r,
        card: f.card,
        sites: f.sites,
        nearest: nearestSite(f.sites, origin),
        languageWarning: answers.language !== "en" && f.card.barriers.some((b) => b.type === "english_required"),
        precheck: notes,
        scores: { ...r.scores, precheckPenalty: features.penalty, phaseBonus: phase, features, ...(unknowns !== undefined ? { unknowns } : {}), final: fusedScore(features, r.scores.fit) },
      },
    ];
  });
  return { ...outcome, results };
}
