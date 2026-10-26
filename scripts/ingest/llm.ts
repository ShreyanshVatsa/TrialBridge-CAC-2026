/**
 * Local-LLM eligibility-fact extraction for the v2 fact families (high-precision layer over the rules).
 * Reads PUBLIC ClinicalTrials.gov trial text only (conditions + numbered criteria); never patient data.
 *
 *   npm run ingest:llm -- --families lines,prior_drug --limit 50      (sample)
 *   npm run ingest:llm -- --dry                                        (count calls + time estimate, no model)
 *   npm run ingest:llm                                                  (FULL national run, all families, ~1 day)
 *   then: npm run ingest                                                (merges the cache into the shards)
 *
 * Overnight run (the only family that passed the gold gate, ~5 h on an M4 Pro; resumable, rerun the same command
 * after an interruption):
 *   nohup npm run ingest:llm -- --families other_malignancy > data/cache/llm-run.log 2>&1 && npm run ingest
 * All LLM-layer families (support-only except other_malignancy; ~24 h, can be split over several nights):
 *   npm run ingest:llm -- --families lines,prior_drug,stage,recurrent,other_malignancy,hepatitis,biomarker_v2
 *
 * Flags (both `--x=v` and `--x v` work):
 *   --families a,b      subset of: lines, prior_drug, stage, recurrent, other_malignancy, hepatitis, biomarker_v2, histology, autoimmune
 *   --limit N           at most N trials this run (largest cancer groups first)
 *   --source national|seed   trial source (default national: data/cache/national pages)
 *   --split dev|held|all     only trials of one dev/held partition (default all)
 *   --ids NCT1,NCT2     only these trials
 *   --pairs NCT1:lines,NCT2:hepatitis   only these (trial, family) pairs
 *   --concurrency N     parallel requests (default 4 = llama-server -np 4)
 *   --dry               plan only
 * Env: LLM_BASE_URL (default http://127.0.0.1:8091), LLM_MODEL (gguf path; default ~/models/Qwen3-14B-Q4_K_M.gguf).
 *
 * Only trials where the rules found a family keyword (or any fact of the family) are sent for that family.
 * Resumable: each (trial, family) result is appended to data/cache/llm-facts-v2.jsonl keyed by
 * NCT id + last-updated date + the family's prompt version, so a rerun skips everything already done.
 * If no server is listening, one is started with the command below and stopped at the end:
 *   llama-server -m <model> --port 8091 --host 127.0.0.1 -c 32768 -ngl 99 --jinja -np 4
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { loadCards } from "./cards";
import { partitionOf } from "../../lib/ingest/precision";
import { buildFamilyMessages, decisionProbs, familySchema, familyCacheKey, LLM_FAMILY_IDS, parseFamilyOutput, relevantFamilies, type FamilyCacheEntry, type LlmFamily, type LlmTrialText } from "../../lib/ingest/llm-families";
import type { Fact } from "../../lib/types/trial";

/** v1 cache (whole-trial prompt, 2026-10-06 sample); still merged by `npm run ingest` for those 4 trials. */
export const LLM_CACHE_FILE = "data/cache/llm-facts.json";
export interface LlmCacheEntry {
  model: string;
  facts: Fact[];
  discarded: number;
  seconds: number;
}
export const LLM_V2_CACHE_FILE = "data/cache/llm-facts-v2.jsonl";

/** Read the append-only v2 cache (later lines win). */
export function readV2Cache(file = LLM_V2_CACHE_FILE): Map<string, FamilyCacheEntry> {
  const map = new Map<string, FamilyCacheEntry>();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const { k, e } = JSON.parse(line) as { k: string; e: FamilyCacheEntry };
      map.set(k, e);
    } catch {
      /* a torn last line from an interrupted run: ignore */
    }
  }
  return map;
}

function parseArgs(argv: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) m.set(a.slice(2, eq), a.slice(eq + 1));
    else if (argv[i + 1] !== undefined && !(argv[i + 1] as string).startsWith("--")) m.set(a.slice(2), argv[++i] as string);
    else m.set(a.slice(2), "true");
  }
  return m;
}

const BASE = process.env.LLM_BASE_URL ?? "http://127.0.0.1:8091";
const MODEL = process.env.LLM_MODEL ?? path.join(os.homedir(), "models/Qwen3-14B-Q4_K_M.gguf");

async function healthy(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<ChildProcess | null> {
  if (await healthy()) return null;
  const port = new URL(BASE).port || "8091";
  console.log(`Starting llama-server (${path.basename(MODEL)}) on port ${port} ...`);
  const child = spawn("llama-server", ["-m", MODEL, "--port", port, "--host", "127.0.0.1", "-c", "32768", "-ngl", "99", "--jinja", "-np", "4"], { stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    if (await healthy()) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error("llama-server did not become healthy within 300 s");
}

/** One (trial, family) call. Thinking disabled; logprobs give a token-level confidence for the decisive fields. */
export async function callFamily(family: LlmFamily, t: LlmTrialText, slot: number, scheduled: readonly LlmFamily[]): Promise<FamilyCacheEntry> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: buildFamilyMessages(family, t, scheduled),
      temperature: 0,
      max_tokens: 600,
      // Grammar-constrained sampling (json_schema / json_object) was 3-10x slower per token on this machine, so the
      // output is free text parsed and zod-validated (invalid output => no facts, never a guess).
      ...(process.env.LLM_GRAMMAR === "1" ? { response_format: { type: "json_schema", json_schema: { schema: familySchema(family, t) } } } : {}),
      chat_template_kwargs: { enable_thinking: false },
      logprobs: true,
      top_logprobs: 1,
      id_slot: slot,
      cache_prompt: true,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`llama-server HTTP ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string }; logprobs?: { content?: { token: string; logprob: number }[] } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  let out: ReturnType<typeof parseFamilyOutput>;
  try {
    out = parseFamilyOutput(content);
  } catch {
    // Malformed JSON (e.g. an unescaped quote inside "quote"): cached as "no facts" (abstain), not retried forever.
    out = { facts: [], invalid: 1 };
  }
  const probs = decisionProbs(content, data.choices?.[0]?.logprobs?.content ?? []);
  const facts = out.facts.map((f, i) => (probs[i] !== undefined ? { ...f, lp: Math.round((probs[i] as number) * 1000) / 1000 } : f));
  return { model: path.basename(MODEL), facts, invalid: out.invalid, seconds: (Date.now() - t0) / 1000 };
}

export const toTrialText = (c: { id: string; lastUpdated: string; groups: LlmTrialText["groups"]; conditions: readonly string[]; title?: string; inclusion: LlmTrialText["inclusion"]; exclusion: LlmTrialText["exclusion"] }): LlmTrialText => ({
  id: c.id,
  lastUpdated: c.lastUpdated,
  groups: c.groups,
  conditions: [...c.conditions, ...(c.title ? [c.title] : [])],
  inclusion: c.inclusion,
  exclusion: c.exclusion,
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const families = (args.get("families")?.split(",").map((s) => s.trim()).filter(Boolean) ?? LLM_FAMILY_IDS) as LlmFamily[];
  const bad = families.filter((f) => !LLM_FAMILY_IDS.includes(f));
  if (bad.length) throw new Error(`Unknown families: ${bad.join(", ")} (allowed: ${LLM_FAMILY_IDS.join(", ")})`);
  const limit = args.has("limit") ? Number(args.get("limit")) : Infinity;
  const concurrency = Math.max(1, Number(args.get("concurrency") ?? 4));
  const split = args.get("split") ?? "all";
  const ids = args.get("ids")?.split(",").map((s) => s.trim());
  // --pairs NCT1:lines,NCT2:hepatitis  restricts each trial to the listed families (dev labeling runs).
  const pairs = args.get("pairs")?.split(",").reduce((m, p) => {
    const [id, fam] = p.trim().split(":");
    if (id && fam) m.set(id, [...(m.get(id) ?? []), fam as LlmFamily]);
    return m;
  }, new Map<string, LlmFamily[]>());

  const cards = loadCards((args.get("source") as "national" | "seed" | undefined) ?? "national").filter((c) => (split === "all" || partitionOf(c.id) === split) && (!ids || ids.includes(c.id)) && (!pairs || pairs.has(c.id)));
  const cache = readV2Cache();
  const size = new Map<string, number>();
  for (const c of cards) for (const g of c.groups) size.set(g, (size.get(g) ?? 0) + 1);
  const rank = (c: (typeof cards)[number]) => Math.max(0, ...c.groups.map((g) => size.get(g) ?? 0));
  const plan: { t: LlmTrialText; fams: LlmFamily[] }[] = [];
  let cachedCalls = 0;
  for (const c of [...cards].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id))) {
    const t = toTrialText(c);
    const fams = relevantFamilies(t, c.facts, pairs?.get(c.id) ?? families);
    const todo = fams.filter((f) => !cache.has(familyCacheKey(c.id, c.lastUpdated, f)));
    cachedCalls += fams.length - todo.length;
    if (todo.length) plan.push({ t, fams: todo });
  }
  const batch = plan.slice(0, limit);
  const calls = batch.reduce((s, p) => s + p.fams.length, 0);
  const allCalls = plan.reduce((s, p) => s + p.fams.length, 0);
  console.log(`LLM v2 facts [${families.join(", ")}]: ${cards.length} trials, ${plan.length} with work left (${allCalls} calls), ${cachedCalls} calls cached; this run: ${batch.length} trials, ${calls} calls, concurrency ${concurrency}`);
  if (args.has("dry")) {
    // Measured on this machine (M4 Pro, Qwen3-14B Q4_K_M, -np 4, 2026-10-08): 5.9 s per call wall clock on the
    // 240 gold trials (all families; 20.8 s/trial), 6.3 s per call on single-family dev calls. Override with --sec-per-call.
    const per = Number(args.get("sec-per-call") ?? 6);
    console.log(`Estimate at ${per} s/call (wall clock, ${concurrency} parallel): ~${((allCalls * per) / 3600).toFixed(1)} h for all ${allCalls} calls (${plan.length} trials)`);
    return;
  }
  if (batch.length === 0) return;
  const server = await ensureServer();
  mkdirSync(path.dirname(LLM_V2_CACHE_FILE), { recursive: true });
  let next = 0;
  let doneTrials = 0;
  let doneCalls = 0;
  let failed = 0;
  const t0 = Date.now();
  const worker = async (slot: number) => {
    for (;;) {
      const i = next++;
      if (i >= batch.length) return;
      const { t, fams } = batch[i] as (typeof batch)[number];
      for (const fam of fams) {
        try {
          const e = await callFamily(fam, t, slot, fams);
          appendFileSync(LLM_V2_CACHE_FILE, `${JSON.stringify({ k: familyCacheKey(t.id, t.lastUpdated, fam), e })}\n`);
        } catch (err) {
          failed++;
          console.warn(`  ${t.id} ${fam}: ${err instanceof Error ? err.message : String(err)}`);
        }
        doneCalls++;
      }
      doneTrials++;
      const el = (Date.now() - t0) / 1000;
      const per = el / doneTrials;
      if (doneTrials % 5 === 0 || doneTrials === batch.length) {
        console.log(`  ${doneTrials}/${batch.length} trials, ${doneCalls}/${calls} calls, ${per.toFixed(1)} s/trial wall, ETA ${((per * (batch.length - doneTrials)) / 60).toFixed(0)} min (all remaining: ${((per * (plan.length - doneTrials)) / 3600).toFixed(1)} h)`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, (_, s) => worker(s)));
  } finally {
    server?.kill();
  }
  const el = (Date.now() - t0) / 1000;
  console.log(`Done: ${doneCalls - failed} calls ok, ${failed} failed, ${el.toFixed(0)} s (${(el / Math.max(1, doneTrials)).toFixed(1)} s/trial wall). Run \`npm run ingest\` to merge.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
