/**
 * Work budgets (perf/budgets.json `work`): how much the engine computes for a fixed search and a fixed questionnaire
 * flow over the committed seed. Counts, not milliseconds, so the test is deterministic on any machine. A change that
 * raises a count above its budget must either be made cheaper or re-baseline the budget deliberately.
 */
import { readFileSync } from "node:fs";
import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import { FACT_POLICY, getCatalog } from "@/config/questionnaire";
import { perfCounters, resetPerfCounters, snapshotPerfCounters } from "@/lib/perf/counters";
import { buildProfileText } from "@/lib/match/query";
import { rankTrials, type RankEntry } from "@/lib/match/rank";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, toSearchDoc, type SearchDoc } from "@/lib/match/minisearch-config";
import { applyAnswer, createState, nextQuestion, type CandidatePool } from "@/lib/questionnaire/engine";
import { patientAnswer, samplePatient } from "@/lib/questionnaire/simulate";
import type { IntakeAnswers } from "@/lib/types/intake";
import type { QuestionnaireState } from "@/lib/types/questionnaire";
import { loadSeedCards, loadZip, zipCentroid } from "../../scripts/eval/common";

const budgets = (JSON.parse(readFileSync("perf/budgets.json", "utf8")) as { work: Record<string, number> }).work;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("work budgets on the seed", () => {
  const zips = loadZip();
  const { cards, sites } = loadSeedCards(zips);
  const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
  index.addAll(cards.map(toSearchDoc));

  it("search: cosines, BM25 searches and fact relations for one breast profile", () => {
    const labels = JSON.parse(readFileSync("eval/labels.json", "utf8")) as { profiles: Array<{ id: string; answers: IntakeAnswers; state: QuestionnaireState }> };
    const p = labels.profiles.find((x) => x.id === "p01") as (typeof labels.profiles)[number];
    const catalog = getCatalog("cancer", p.answers.cancerType);
    const a: IntakeAnswers = { ...p.answers, questionnaire: p.state };
    const text = buildProfileText(a, catalog);
    // A fixed pseudo-vector stands in for the embedding (the count does not depend on its values).
    const dims = 384;
    const q = Float32Array.from({ length: dims }, (_, i) => Math.sin(i));
    const entries: RankEntry[] = cards.map((c) => ({ card: c, sites: sites.get(c.id) ?? [], vector: Int8Array.from({ length: dims }, (_, i) => (i % 7) - 3) }));
    resetPerfCounters();
    const out = rankTrials({ entries, answers: a, origin: zipCentroid(zips, a.zip), keywordSearch: (ids) => index.search(text, { ...MINISEARCH_SEARCH, filter: (r) => ids.has(String(r.id)) }).map((r) => String(r.id)), queryVector: q, catalog, policy: FACT_POLICY });
    const c = snapshotPerfCounters();
    console.log(`PERF search cosines=${c.cosine} factRelations=${c.factRelation} results=${out.results.length} candidates=${out.candidateCount}`);
    expect(out.results.length).toBeGreaterThan(0);
    expect(c.cosine).toBeLessThanOrEqual(budgets.searchCosines as number);
    expect(c.factRelation).toBeLessThanOrEqual(budgets.searchFactRelations as number);
    expect(perfCounters.bm25Search).toBeLessThanOrEqual(budgets.searchBm25Searches as number);
  });

  it("questionnaire: fact relations, re-scores and trial scores over 3 groups x 2 patients x 8 steps", () => {
    const r = mulberry32(2026);
    resetPerfCounters();
    let steps = 0;
    for (const g of ["breast", "lung", "leukemia"] as const) {
      const catalog = getCatalog("cancer", g);
      const list = cards.filter((c) => c.groups.includes(g));
      const pool: CandidatePool = { group: g, trials: list.map((c, i) => ({ id: c.id, prior: 1 - i / list.length, facts: c.facts, sex: c.sex })) };
      const base: QuestionnaireState = { ...createState("thorough", 1), answers: { cancer_type: g, age: 55, zip: "02115", travel: null }, history: ["cancer_type", "age", "zip", "travel"] };
      for (let p = 0; p < 2; p++) {
        const patient = samplePatient(r, base, catalog, g);
        let state = base;
        for (let k = 0; k < 8; k++) {
          const step = nextQuestion(state, pool, catalog, { policy: FACT_POLICY });
          if (step.kind === "done") break;
          steps++;
          state = applyAnswer(state, step.question.id, patientAnswer(patient, step.question), catalog, { now: 1 }).state;
        }
      }
    }
    const c = snapshotPerfCounters();
    console.log(`PERF questionnaire steps=${steps} factRelations=${c.factRelation} rescores=${c.rescore} trialScores=${c.trialScore}`);
    expect(steps).toBeGreaterThan(20);
    expect(c.factRelation).toBeLessThanOrEqual(budgets.questionnaireFactRelations as number);
    expect(c.rescore).toBeLessThanOrEqual(budgets.questionnaireRescores as number);
    expect(c.trialScore).toBeLessThanOrEqual(budgets.questionnaireTrialScores as number);
  });
});
