/**
 * Behavior fingerprint: a hash of the engine's question sequences/utilities and the ranker's top results over fixed
 * patients and profiles. Run in two checkouts to prove a refactor changed nothing (`npx tsx scripts/eval/fingerprint.ts`).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import MiniSearch from "minisearch";
import { FACT_POLICY, getCatalog } from "../../config/questionnaire";
import { buildProfileText } from "../../lib/match/query";
import { rankTrials, type RankEntry } from "../../lib/match/rank";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, toSearchDoc, type SearchDoc } from "../../lib/match/minisearch-config";
import { applyAnswer, createState, nextQuestion, rankPool, type CandidatePool } from "../../lib/questionnaire/engine";
import { patientAnswer, samplePatient } from "../../lib/questionnaire/simulate";
import type { IntakeAnswers } from "../../lib/types/intake";
import type { QuestionnaireState } from "../../lib/types/questionnaire";
import { CANCER_GROUP_IDS } from "../../config/cancer-groups";
import { loadSeedCards, loadZip, zipCentroid } from "./common";
import { quantize } from "./embed";
import { embeddingText } from "../../lib/ingest/record";

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

const lines: string[] = [];
const { cards, sites } = loadSeedCards(loadZip());

// Engine: adaptive flows for simulated patients on the seed pools.
const r = mulberry32(99);
for (const g of CANCER_GROUP_IDS.slice(0, 12)) {
  const catalog = getCatalog("cancer", g);
  const sorted = cards.filter((c) => c.groups.includes(g));
  const pool: CandidatePool = { group: g, trials: sorted.map((c, i, all) => ({ id: c.id, prior: 1 - i / all.length, facts: c.facts, sex: c.sex })) };
  const base: QuestionnaireState = { ...createState("thorough", 1), answers: { cancer_type: g, age: 55, zip: "02115", travel: null }, history: ["cancer_type", "age", "zip", "travel"] };
  for (let p = 0; p < 6; p++) {
    const patient = samplePatient(r, base, catalog, g);
    let state = base;
    for (let k = 0; k < 14; k++) {
      const step = nextQuestion(state, pool, catalog, { policy: FACT_POLICY });
      if (step.kind === "done") {
        lines.push(`${g}/${p}/${k} done ${step.reason}`);
        break;
      }
      lines.push(`${g}/${p}/${k} ${step.question.id} ${step.utility.toFixed(10)} ${step.impact.total}/${step.impact.narrowedTo}`);
      state = applyAnswer(state, step.question.id, patientAnswer(patient, step.question), catalog, { now: 1 }).state;
    }
    lines.push(`${g}/${p} top ${rankPool(state, pool, catalog, { policy: FACT_POLICY }).slice(0, 10).map((x) => `${x.id}:${x.score.toFixed(10)}`).join(",")}`);
  }
}

// Ranker: v1 and v2 pipelines over the labeled profiles with the cached production query/trial embeddings.
const labels = JSON.parse(readFileSync("eval/labels.json", "utf8")) as { profiles: Array<{ id: string; answers: IntakeAnswers; state: QuestionnaireState }> };
const emb = JSON.parse(readFileSync("data/cache/eval-emb-minilm-q8.json", "utf8")) as Record<string, number[]>;
const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
index.addAll(cards.map(toSearchDoc));
const entries: RankEntry[] = cards.map((c) => ({ card: c, sites: sites.get(c.id) ?? [], vector: quantize(Float32Array.from(emb[embeddingText(c)] as number[])) }));
const zips = loadZip();
for (const p of labels.profiles) {
  for (const v2 of [false, true]) {
    const catalog = getCatalog("cancer", p.answers.cancerType);
    const a: IntakeAnswers = v2 ? { ...p.answers, questionnaire: p.state } : p.answers;
    const text = buildProfileText(a, v2 ? catalog : undefined);
    const q = emb[text];
    const out = rankTrials({
      entries,
      answers: a,
      origin: zipCentroid(zips, a.zip),
      keywordSearch: (ids) => index.search(text, { ...MINISEARCH_SEARCH, filter: (res) => ids.has(String(res.id)) }).map((x) => String(x.id)),
      queryVector: q ? Float32Array.from(q) : null,
      ...(v2 ? { catalog, policy: FACT_POLICY } : {}),
    });
    lines.push(`${p.id}/${v2 ? "v2" : "v1"} ${out.candidateCount} ${out.results.map((x) => `${x.card.id}:${x.scores.final.toFixed(10)}`).join(",")}`);
  }
}
if (process.env.FP_OUT) writeFileSync(process.env.FP_OUT, lines.join("\n"));
console.log(`${lines.length} lines, sha256 ${createHash("sha256").update(lines.join("\n")).digest("hex")}`);
