/**
 * Reciprocal Rank Fusion (RRF), written by hand.
 *
 * We rank trials two different ways (keyword BM25 and embedding similarity). Their raw scores
 * are on different scales, so instead of mixing scores we mix RANKS:
 *
 *   RRF(trial) = sum over each ranking r of  1 / (k + rank_r(trial))
 *
 * - rank is 1-based (best = 1). A trial missing from a ranking contributes nothing for it.
 * - k (config/retrieval.ts; Cormack et al., 2009 suggest 60) dampens the gap between top ranks so a single
 *   method can't dominate; a trial ranked well by BOTH methods rises to the top.
 */
import { RRF_K } from "@/config/retrieval";
export { RRF_K };

interface FusedResult {
  id: string;
  /** Fused RRF score (higher is better). */
  score: number;
  /** 1-based rank in each input ranking, or null if absent from it (same order as inputs). */
  ranks: (number | null)[];
}

/**
 * Fuse several rankings (each an array of IDs, best first) into one, best first.
 * Ties are broken by best single rank, then ID, so output is deterministic.
 */
export function reciprocalRankFusion(rankings: readonly (readonly string[])[], k: number = RRF_K): FusedResult[] {
  if (k <= 0) throw new Error("reciprocalRankFusion: k must be positive");
  const fused = new Map<string, FusedResult>();

  rankings.forEach((ranking, r) => {
    const seen = new Set<string>(); // ignore duplicate IDs within one ranking
    ranking.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      const rank = index + 1; // convert 0-based position to 1-based rank
      let entry = fused.get(id);
      if (!entry) {
        entry = { id, score: 0, ranks: rankings.map(() => null) };
        fused.set(id, entry);
      }
      entry.score += 1 / (k + rank); // this ranking's contribution
      entry.ranks[r] = rank;
    });
  });

  const bestRank = (e: FusedResult) => Math.min(...e.ranks.map((x) => x ?? Infinity));
  return [...fused.values()].sort((a, b) => b.score - a.score || bestRank(a) - bestRank(b) || a.id.localeCompare(b.id));
}

/** The highest RRF score possible: rank 1 in every one of `n` rankings. Used to normalize to 0..1. */
export function maxRrfScore(n: number, k: number = RRF_K): number {
  return n / (k + 1);
}
