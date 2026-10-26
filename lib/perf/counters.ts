/**
 * Work counters for the matching engine: how many cosine similarities, BM25 searches, fact relations and trial
 * re-scores a search or a questionnaire step performs. Counts are deterministic for a given input (unlike wall time),
 * so tests/unit/perf-budget.test.ts can hold the engine to a budget (perf/budgets.json) on any machine.
 * Incrementing a field costs nothing measurable; the counters are never sent anywhere.
 */
export const perfCounters = {
  cosine: 0,
  bm25Search: 0,
  factRelation: 0,
  trialScore: 0,
  rescore: 0,
};
type PerfCounters = typeof perfCounters;

export function resetPerfCounters(): void {
  for (const k of Object.keys(perfCounters) as (keyof PerfCounters)[]) perfCounters[k] = 0;
}

export function snapshotPerfCounters(): PerfCounters {
  return { ...perfCounters };
}
