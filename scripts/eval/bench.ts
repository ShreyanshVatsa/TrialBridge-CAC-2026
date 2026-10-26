/**
 * Node microbenchmarks for the matching and engine hot paths over the national shards (`npx tsx scripts/eval/bench.ts`).
 * Reports MEDIAN milliseconds (machines are noisy; the median ignores scheduler spikes). Run it from two checkouts
 * back to back to compare before/after. `NATIONAL_DIR` selects the data (see national.ts).
 */
import { readFileSync } from "node:fs";
import MiniSearch from "minisearch";
import { getCatalog, FACT_POLICY } from "../../config/questionnaire";
import type { CancerGroupId } from "../../config/cancer-groups";
import { buildProfileText } from "../../lib/match/query";
import { rankTrials } from "../../lib/match/rank";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, type SearchDoc } from "../../lib/match/minisearch-config";
import { applyAnswer, createState, estimateRemaining, liveCount, nextQuestion, rankPool, type CandidatePool } from "../../lib/questionnaire/engine";
import { patientAnswer, samplePatient } from "../../lib/questionnaire/simulate";
import type { IntakeAnswers } from "../../lib/types/intake";
import type { QuestionnaireState } from "../../lib/types/questionnaire";
import { loadZip, zipCentroid } from "./common";
import { loadNational } from "./national";

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;
const ms = (n: number) => n.toFixed(2);
const time = <T,>(f: () => T): [T, number] => {
  const t = performance.now();
  const v = f();
  return [v, performance.now() - t];
};

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

const nat = loadNational();
if (!nat) throw new Error("no national data");
const zips = loadZip();
const GROUPS: CancerGroupId[] = ["lung", "breast", "leukemia"];
const REPS = Number(process.env.BENCH_REPS ?? 15);

// --- Engine: per-question latency along simulated adaptive flows -------------------------------------------
const nextMs: number[] = [];
const applyMs: number[] = [];
const rankPoolMs: number[] = [];
const liveMs: number[] = [];
const perAnswerMs: number[] = [];
const r = mulberry32(42);
for (const g of GROUPS) {
  const catalog = getCatalog("cancer", g);
  const sorted = nat.entries(g).map((e) => e.card).filter((c) => c.groups.includes(g)).sort((a, b) => a.id.localeCompare(b.id));
  const pool: CandidatePool = { group: g, trials: sorted.map((c, i, all) => ({ id: c.id, prior: 1 - i / all.length, facts: c.facts, sex: c.sex })) };
  const base: QuestionnaireState = { ...createState("thorough", 1), answers: { cancer_type: g, age: 55, zip: "02115", travel: null }, history: ["cancer_type", "age", "zip", "travel"] };
  for (let p = 0; p < 8; p++) {
    const patient = samplePatient(r, base, catalog, g);
    let state = base;
    for (let k = 0; k < 8; k++) {
      // What the UI does after every answer: live counter, next question, "about N more" (a fresh state object each time).
      const fresh: QuestionnaireState = { ...state };
      const [, dAll] = time(() => {
        liveCount(fresh, pool, catalog, { policy: FACT_POLICY });
        nextQuestion(fresh, pool, catalog, { policy: FACT_POLICY });
        estimateRemaining(fresh, pool, catalog, { policy: FACT_POLICY });
      });
      perAnswerMs.push(dAll);
      const [step, dt] = time(() => nextQuestion({ ...state }, pool, catalog, { policy: FACT_POLICY }));
      nextMs.push(dt);
      if (step.kind === "done") break;
      const [, dr] = time(() => rankPool(state, pool, catalog, { policy: FACT_POLICY }));
      rankPoolMs.push(dr);
      const [, dl] = time(() => liveCount(state, pool, catalog, { policy: FACT_POLICY }));
      liveMs.push(dl);
      const [res, da] = time(() => applyAnswer(state, step.question.id, patientAnswer(patient, step.question), catalog, { now: 1 }));
      applyMs.push(da);
      state = res.state;
    }
  }
}
console.log(`engine  per answer (liveCount+nextQuestion+estimateRemaining) median ${ms(median(perAnswerMs))} ms; nextQuestion median ${ms(median(nextMs))} ms (n=${nextMs.length}, p90 ${ms([...nextMs].sort((a, b) => a - b)[Math.floor(nextMs.length * 0.9)] as number)}), rankPool ${ms(median(rankPoolMs))} ms, liveCount ${ms(median(liveMs))} ms, applyAnswer ${ms(median(applyMs))} ms`);

// --- Search: first search (index load + rank) and repeat search -------------------------------------------
const labels = JSON.parse(readFileSync("eval/labels.json", "utf8")) as { profiles: Array<{ id: string; answers: IntakeAnswers; state: QuestionnaireState }> };
const embCache = JSON.parse(readFileSync("data/cache/eval-emb-minilm-q8.json", "utf8")) as Record<string, number[]>;
const firstMs: number[] = [];
const repeatMs: number[] = [];
const loadMs: number[] = [];
for (const pid of ["p05", "p01", "p15"]) {
  const p = labels.profiles.find((x) => x.id === pid);
  if (!p) continue;
  const a: IntakeAnswers = { ...p.answers, questionnaire: p.state };
  const g = a.cancerType;
  const catalog = getCatalog("cancer", g);
  const text = buildProfileText(a, catalog);
  const cached = embCache[text];
  const qv = cached ? Float32Array.from(cached) : Float32Array.from({ length: nat.dims }, (_, i) => Math.sin(i * 1.7 + pid.length));
  const origin = zipCentroid(zips, a.zip);
  for (let rep = 0; rep < REPS; rep++) {
    // Cold: build indexes from JSON like the browser's first search, then rank.
    const [indexes, dl] = time(() => nat.shardIds(g).map((id) => MiniSearch.loadJSON<SearchDoc>(nat.shard(id).indexJson, MINISEARCH_OPTIONS)));
    loadMs.push(dl);
    const entries = nat.entries(g);
    const keywordSearch = (ids: ReadonlySet<string>) => {
      const scores = new Map<string, number>();
      for (const idx of indexes) for (const x of idx.search(text, { ...MINISEARCH_SEARCH, filter: (res) => ids.has(String(res.id)) })) scores.set(String(x.id), Math.max(scores.get(String(x.id)) ?? 0, x.score));
      return [...scores.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id);
    };
    const [, cold] = time(() => rankTrials({ entries, answers: a, origin, keywordSearch, queryVector: qv, catalog, policy: FACT_POLICY }));
    firstMs.push(cold + dl);
    const [, warm] = time(() => rankTrials({ entries, answers: a, origin, keywordSearch, queryVector: qv, catalog, policy: FACT_POLICY }));
    repeatMs.push(warm);
  }
}
console.log(`search  index load median ${ms(median(loadMs))} ms; first search (load + rank) ${ms(median(firstMs))} ms; repeat rankTrials ${ms(median(repeatMs))} ms (${GROUPS.join("/")} profiles p05,p01,p15, n=${repeatMs.length})`);
