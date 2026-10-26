/**
 * Live check of the production judge path on the Groq free tier: 5 TREC dev patients, judged one right after
 * another exactly as /api/match would (production judgeCriteria with its 45 s request deadline, the production
 * OpenAI-compatible client with its 429 retry, the daily token budget), with NO eval pacing or response cache.
 * Trials and unknown items are what the app would send: the top MATCH_JUDGE.topN of the retrieval order after the
 * resolver, screening-only items left out. Not run in CI (it spends real quota).
 *
 *   npx tsx scripts/eval/matching/live-check.ts [--patients=5]
 */
import { readFileSync } from "node:fs";
import { AI_PROVIDERS } from "../../../config/ai-providers";
import { getCatalog } from "../../../config/questionnaire";
import { MATCH_JUDGE } from "../../../config/match-judge";
import { createOpenAiCompatibleProvider } from "../../../functions/lib/ai/openai-client";
import { CircuitBreaker } from "../../../functions/lib/ai/circuit";
import { tryConsumeBudget, tryConsumeTokens } from "../../../functions/lib/budget";
import { MemoryKvStore } from "../../../functions/lib/store";
import { judgeCriteria, type JudgeTrialInput } from "../../../functions/lib/match";
import { FUSION_WEIGHTS } from "../../../lib/match/fusion";
import { judgeRequests, resolverLabels } from "../../../lib/match/criteria-rank";
import { TOP_N } from "../../../lib/match/rank";
import { minimizeProfile } from "../../../lib/privacy/minimize";
import { toIntakeAnswers } from "../../../lib/questionnaire/adapter";
import type { TrialCard } from "../../../lib/types/trial";
import { rankIds } from "../fusion-fit";
import { loadTrec } from "../trec/load";
import { topicState, trecQueries } from "../trec/pipeline";

const N = Number(process.argv.find((a) => a.startsWith("--patients="))?.split("=")[1] ?? 5);
const key = process.env.GROQ_API_KEY ?? readFileSync(".dev.vars", "utf8").split("\n").find((l) => l.startsWith("GROQ_API_KEY="))?.slice(13).trim().replace(/^["']|["']$/g, "");
if (!key) {
  console.log("SKIPPED: no GROQ_API_KEY");
  process.exit(0);
}
const cfg = AI_PROVIDERS.find((p) => p.name === "groq");
if (!cfg) throw new Error("no groq provider config");
const groq = createOpenAiCompatibleProvider(cfg, key);
const store = new MemoryKvStore();
const breaker = new CircuitBreaker();

const bench = loadTrec();
const cards = new Map<string, TrialCard>(bench.topics.flatMap((t) => t.trials.map((x) => [x.card.id, x.card] as const)));
const { queries } = await trecQueries();
const topics = bench.topics.filter((t) => t.year === 2021).slice(0, N);
const rows: string[] = [];
for (const t of topics) {
  const q = queries.find((x) => x.id === t.key);
  if (!q) continue;
  const results = rankIds(q, FUSION_WEIGHTS)
    .slice(0, TOP_N)
    .map((id) => ({ card: cards.get(id) as TrialCard }));
  const answers = toIntakeAnswers(topicState(t), "en");
  const resolver = resolverLabels(results, answers, getCatalog("cancer", t.answers.group));
  const inputs: JudgeTrialInput[] = judgeRequests(results, resolver).map((w) => {
    const c = cards.get(w.nctId) as TrialCard;
    const ids = new Set(w.unknownIds);
    return { trialId: c.id, criteriaVersion: w.criteriaVersion, title: c.title, ...(c.summary ? { summary: c.summary } : {}), items: (c.criteria ?? []).filter((x) => ids.has(x.id)) };
  });
  const sent = inputs.reduce((s, x) => s + x.items.length, 0);
  let tokens = 0;
  const t0 = Date.now();
  const out = await judgeCriteria(minimizeProfile(answers), inputs, {
    store,
    providers: [groq],
    breakerFor: () => breaker,
    consumeBudget: async (p, n = 0) => {
      tokens += n;
      return (await tryConsumeBudget(store, p.name, 800)) && tryConsumeTokens(store, p.name, n, 180_000);
    },
    log: (e) => {
      if (e.status !== "ok") console.log(`  log ${JSON.stringify(e)}`);
    },
  });
  const judged = out.results.reduce((s, r) => s + Math.round((r.coverage ?? 0) * (inputs.find((x) => x.trialId === r.trialId)?.items.length ?? 0)), 0);
  const row = `${t.key}: ${out.ok ? "ok" : `degraded (${out.reason})`}, ${inputs.length} trials, items judged ${judged}/${sent} (${sent ? Math.round((100 * judged) / sent) : 100}%), reserved ~${tokens} tokens, ${((Date.now() - t0) / 1000).toFixed(1)} s (deadline ${MATCH_JUDGE.deadlineMs / 1000} s)`;
  console.log(row);
  rows.push(row);
}
console.log(`\n${rows.length} patients back to back; ${rows.filter((r) => r.includes(": ok")).length} ok`);
