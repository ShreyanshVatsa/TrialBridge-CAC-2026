/**
 * Retrieval/ranking weight sweep with a TUNING split (30 profiles) and a HELD-OUT split (10 profiles: every 4th, p04, p08, ... p40),
 * on (a) the seed (eval/labels.json) and (b) the national shards (public/data or NATIONAL_DIR), where the SAME written
 * title/condition label rules (make-labels.ts) are applied to the national trials. Labels never look at facts or embeddings.
 * `npx tsx scripts/eval/tune-retrieval.ts [--quick]`. Prints one line per candidate setting; the chosen values are baked into lib/match as literals.
 */
import { readFileSync } from "node:fs";
import MiniSearch from "minisearch";
import { FACT_POLICY, getCatalog } from "../../config/questionnaire";
import type { CancerGroupId } from "../../config/cancer-groups";
import { buildProfileText } from "../../lib/match/query";
import { rankTrials, type RankEntry } from "../../lib/match/rank";
import { MINISEARCH_OPTIONS, MINISEARCH_SEARCH, toSearchDoc, type SearchDoc } from "../../lib/match/minisearch-config";
import { factWeight, reliability } from "../../lib/match/score";
import type { IntakeAnswers } from "../../lib/types/intake";
import type { QuestionnaireState } from "../../lib/types/questionnaire";
import type { PrecheckNote } from "../../lib/types/match";
import { embeddingText } from "../../lib/ingest/record";
import { loadSeedCards, loadZip, zipCentroid } from "./common";
import { MODELS, embedAll, quantize } from "./embed";
import { labelProfile, PROFILES } from "./make-labels";
import { loadNational } from "./national";

export interface Params {
  k: number; // RRF k
  wKw: number; // weight of the keyword ranking in fusion
  wVec: number;
  conflict: number; // CONFLICT_PENALTY
  maxConflicts: number;
  support: number; // SUPPORT_BONUS
  bio: number; // BIOMARKER_MATCH_BONUS
}
export const DEFAULTS: Params = { k: 60, wKw: 1, wVec: 1, conflict: 0.15, maxConflicts: 4, support: 0.03, bio: 0.08 };

interface Row { id: string; kw: number | null; vec: number | null; notes: PrecheckNote[]; phase: number }
interface Case { pid: string; heldOut: boolean; rel: Set<string>; exc: Set<string>; rows: Row[] }

const ndcg10 = (ranked: string[], rel: Set<string>): number => {
  if (rel.size === 0) return NaN;
  const dcg = ranked.slice(0, 10).reduce((s, id, i) => s + (rel.has(id) ? 1 / Math.log2(i + 2) : 0), 0);
  let idcg = 0;
  for (let i = 0; i < Math.min(rel.size, 10); i++) idcg += 1 / Math.log2(i + 2);
  return dcg / idcg;
};

function finalOf(r: Row, p: Params): number {
  const rrf = (r.kw ? p.wKw / (p.k + r.kw) : 0) + (r.vec ? p.wVec / (p.k + r.vec) : 0);
  const retrieval = Math.min(1, rrf / ((p.wKw + p.wVec) / (p.k + 1)));
  const each = r.notes.filter((n) => n.kind === "conflict").map((n) => p.conflict * factWeight(n) * reliability(n)).sort((a, b) => b - a);
  const pen = each.slice(0, p.maxConflicts).reduce((s, x) => s + x, 0);
  const sup = r.notes.filter((n) => n.kind === "support");
  const bonus = p.support * Math.min(sup.length, 3) + (sup.some((n) => n.value === "required" && n.key.startsWith("biomarker:")) ? p.bio : 0);
  return retrieval - pen + bonus + r.phase;
}

export function evaluate(cases: Case[], p: Params) {
  const part = (held: boolean) => {
    const cs = cases.filter((c) => c.heldOut === held);
    const nd: number[] = [];
    const ex: number[] = [];
    for (const c of cs) {
      const ranked = c.rows.map((r) => ({ id: r.id, f: finalOf(r, p), rrf: (r.kw ? 1 / (p.k + r.kw) : 0) + (r.vec ? 1 / (p.k + r.vec) : 0) }));
      ranked.sort((a, b) => b.f - a.f || b.rrf - a.rrf || a.id.localeCompare(b.id));
      const ids = ranked.map((x) => x.id);
      const n = ndcg10(ids, c.rel);
      if (!Number.isNaN(n)) nd.push(n);
      if (c.exc.size) ex.push(ids.slice(0, 10).filter((i) => c.exc.has(i)).length / Math.min(10, ids.length || 1));
    }
    const m = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    return { ndcg: m(nd), excl: m(ex) };
  };
  return { tune: part(false), held: part(true) };
}

export type BuildOpts = { queryOf?: (text: string, a: IntakeAnswers) => string; search?: typeof MINISEARCH_SEARCH; normalizeShards?: boolean };

async function buildCases(source: "seed" | "national", opts: BuildOpts): Promise<Case[]> {
  const labels = JSON.parse(readFileSync("eval/labels.json", "utf8")) as { profiles: Array<{ id: string; answers: IntakeAnswers; state: QuestionnaireState }> };
  const zips = loadZip();
  const nat = source === "national" ? loadNational() : null;
  if (source === "national" && !nat) throw new Error("no national data");
  const seed = loadSeedCards(zips);
  const seedIndex = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS);
  seedIndex.addAll(seed.cards.map(toSearchDoc));
  const search = opts.search ?? MINISEARCH_SEARCH;

  const profiles = labels.profiles.map((p, i) => {
    const a: IntakeAnswers = { ...p.answers, questionnaire: p.state };
    const catalog = getCatalog("cancer", a.cancerType);
    const text = buildProfileText(a, catalog);
    return { id: p.id, i, a, catalog, text, bm25Text: opts.queryOf ? opts.queryOf(text, a) : text, origin: zipCentroid(zips, a.zip) };
  });
  const vecs = await embedAll("minilm", "q8", profiles.map((p) => MODELS.minilm.queryPrefix + p.text));
  const cases: Case[] = [];
  const entriesCache = new Map<string, RankEntry[]>();
  const seedEntries: RankEntry[] = seed.cards.map((c) => ({ card: c, sites: seed.sites.get(c.id) ?? [], vector: [] }));
  if (source === "seed") {
    const docVecs = await embedAll("minilm", "q8", seed.cards.map(embeddingText));
    seedEntries.forEach((e, j) => (e.vector = quantize(docVecs[j] as Float32Array)));
  }
  for (const p of profiles) {
    const g = p.a.cancerType as CancerGroupId;
    if (source === "national" && g === "other") continue;
    let entries: RankEntry[];
    let keywordSearch: (ids: ReadonlySet<string>) => string[];
    if (source === "seed") {
      entries = seedEntries;
      keywordSearch = (ids) => seedIndex.search(p.bm25Text, { ...search, filter: (r) => ids.has(String(r.id)) }).map((r) => String(r.id));
    } else {
      const n = nat as NonNullable<typeof nat>;
      entries = entriesCache.get(g) ?? n.entries(g);
      entriesCache.set(g, entries);
      const indexes = n.indexes(g);
      keywordSearch = (ids) => {
        const scored: Array<[string, number]> = [];
        for (const idx of indexes) {
          const res = idx.search(p.bm25Text, { ...search, filter: (r) => ids.has(String(r.id)) });
          const top = res[0]?.score ?? 1;
          for (const r of res) scored.push([String(r.id), opts.normalizeShards ? r.score / top : r.score]);
        }
        const best = new Map<string, number>();
        for (const [id, s] of scored) best.set(id, Math.max(best.get(id) ?? 0, s));
        return [...best.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([id]) => id);
      };
    }
    const out = rankTrials({ entries, answers: p.a, origin: p.origin, keywordSearch, queryVector: vecs[p.i] as Float32Array, catalog: p.catalog, policy: FACT_POLICY, limit: 1e9 });
    const cards = entries.map((e) => e.card);
    const sites = new Map(entries.map((e) => [e.card.id, e.sites]));
    const lab = source === "seed" ? { relevant: (labels.profiles[p.i] as unknown as { relevant: string[] }).relevant, excluded: (labels.profiles[p.i] as unknown as { excluded: string[] }).excluded } : labelProfile(PROFILES[p.i]!, cards, sites, p.origin);
    cases.push({
      pid: p.id,
      heldOut: p.i % 4 === 3,
      rel: new Set(lab.relevant),
      exc: new Set(lab.excluded),
      rows: out.results.map((r) => ({ id: r.card.id, kw: r.scores.keywordRank, vec: r.scores.vectorRank, notes: r.precheck, phase: r.scores.phaseBonus ?? 0 })),
    });
  }
  return cases;
}

const f3 = (x: number) => x.toFixed(3);
const fmt = (name: string, e: ReturnType<typeof evaluate>) => `${name.padEnd(34)} tune ${f3(e.tune.ndcg)} (excl ${f3(e.tune.excl)})  held-out ${f3(e.held.ndcg)} (excl ${f3(e.held.excl)})`;

async function main() {
  const sources: Array<"seed" | "national"> = loadNational() ? ["seed", "national"] : ["seed"];
  for (const source of sources) {
    console.log(`\n=== ${source} ===`);
    const cases = await buildCases(source, {});
    console.log(`profiles ${cases.length}, mean candidates ${(cases.reduce((s, c) => s + c.rows.length, 0) / cases.length).toFixed(0)}`);
    console.log(fmt("default", evaluate(cases, DEFAULTS)));
    const sweep = (label: string, key: keyof Params, vals: number[]) => {
      for (const v of vals) console.log(fmt(`${label}=${v}`, evaluate(cases, { ...DEFAULTS, [key]: v })));
    };
    sweep("rrf k", "k", [5, 10, 20, 40, 60, 100]);
    sweep("wKw", "wKw", [0.5, 0.75, 1.5, 2, 3]);
    sweep("conflict", "conflict", [0, 0.05, 0.1, 0.2, 0.3, 0.5]);
    sweep("support", "support", [0, 0.01, 0.06, 0.1]);
    sweep("bio bonus", "bio", [0, 0.04, 0.15]);
    sweep("max conflicts", "maxConflicts", [2, 3, 6]);
  }
}
if (process.argv[1]?.endsWith("tune-retrieval.ts") && !process.argv.includes("--structural") && !process.argv.includes("--combos") && !process.argv.includes("--query")) void main();

/** Structural variants (BM25 query text, field boosts, fuzzy/prefix, per-shard score normalization) at the default weights. */
export async function structural(): Promise<void> {
  const B = MINISEARCH_SEARCH;
  const noNeg = (_t: string, a: IntakeAnswers) => buildProfileText(a, getCatalog("cancer", a.cancerType));
  const dedupe = (t: string) => [...new Set(t.split(/\s+/))].join(" ");
  const variants: Array<[string, BuildOpts]> = [
    ["baseline", {}],
    ["bm25 query w/o 'X negative.'", { queryOf: noNeg }],
    ["bm25 query deduped terms", { queryOf: dedupe }],
    ["shard-normalized bm25", { normalizeShards: true }],
    ["no fuzzy", { search: { ...B, fuzzy: false } }],
    ["no prefix", { search: { ...B, prefix: false } }],
    ["no prefix/fuzzy", { search: { ...B, prefix: false, fuzzy: false } }],
    ["boost title4 cond3 mesh1.5 sum.5 crit.5", { search: { ...B, boost: { title: 4, conditions: 3, mesh: 1.5, summary: 0.5, criteria: 0.5 } } }],
    ["boost title3 cond2.5 mesh1 sum1 crit.25", { search: { ...B, boost: { title: 3, conditions: 2.5, mesh: 1, summary: 1, criteria: 0.25 } } }],
    ["boost title2 cond4 mesh2 sum1 crit1", { search: { ...B, boost: { title: 2, conditions: 4, mesh: 2, summary: 1, criteria: 1 } } }],
    ["boost flat 1", { search: { ...B, boost: { title: 1, conditions: 1, mesh: 1, summary: 1, criteria: 1 } } }],
    ["AND-ish combine (OR default) -> AND", { search: { ...B, combineWith: "AND" } }],
  ];
  for (const source of ["seed", "national"] as const) {
    console.log(`\n=== structural: ${source} ===`);
    for (const [name, o] of variants) console.log(fmt(name, evaluate(await buildCases(source, o), DEFAULTS)));
  }
}
if (process.argv[1]?.endsWith("tune-retrieval.ts") && process.argv.includes("--structural")) void structural();

export async function combos(): Promise<void> {
  const B = MINISEARCH_SEARCH;
  const noNeg = (_t: string, a: IntakeAnswers) => buildProfileText(a, getCatalog("cancer", a.cancerType));
  const crit = { ...B, boost: { title: 3, conditions: 2.5, mesh: 1.5, summary: 1, criteria: 0.25 } };
  const crit5 = { ...B, boost: { title: 3, conditions: 2.5, mesh: 1.5, summary: 1, criteria: 0.5 } };
  const runs: Array<[string, BuildOpts, Partial<Params>]> = [
    ["noNeg", { queryOf: noNeg }, {}],
    ["noNeg+crit.25", { queryOf: noNeg, search: crit }, {}],
    ["noNeg+crit.5", { queryOf: noNeg, search: crit5 }, {}],
    ["crit.25 only", { search: crit }, {}],
    ["noNeg+crit.25+conf.2", { queryOf: noNeg, search: crit }, { conflict: 0.2 }],
    ["noNeg+crit.25+conf.3", { queryOf: noNeg, search: crit }, { conflict: 0.3 }],
    ["noNeg+conf.2", { queryOf: noNeg }, { conflict: 0.2 }],
    ["noNeg+conf.3", { queryOf: noNeg }, { conflict: 0.3 }],
  ];
  for (const source of ["seed", "national"] as const) {
    console.log(`\n=== combos: ${source} ===`);
    for (const [name, o, p] of runs) console.log(fmt(name, evaluate(await buildCases(source, o), { ...DEFAULTS, ...p })));
  }
}
if (process.argv[1]?.endsWith("tune-retrieval.ts") && process.argv.includes("--combos")) void combos();

export async function queryVariants(): Promise<void> {
  const crit = { ...MINISEARCH_SEARCH, boost: { title: 3, conditions: 2.5, mesh: 1.5, summary: 1, criteria: 0.25 } };
  const v1 = (_t: string, a: IntakeAnswers) => buildProfileText({ ...a, questionnaire: undefined });
  const groupOnly = (_t: string, a: IntakeAnswers) => buildProfileText({ ...a, spread: "not_sure", treatments: ["not_sure"], biomarkers: {}, questionnaire: undefined });
  const runs: Array<[string, BuildOpts]> = [
    ["v2 text (crit.25)", { search: crit }],
    ["bm25 = v1 legacy text", { search: crit, queryOf: v1 }],
    ["bm25 = group words only", { search: crit, queryOf: groupOnly }],
  ];
  for (const source of ["seed", "national"] as const) {
    console.log(`\n=== query variants: ${source} ===`);
    for (const [name, o] of runs) console.log(fmt(name, evaluate(await buildCases(source, o), DEFAULTS)));
  }
}
if (process.argv[1]?.endsWith("tune-retrieval.ts") && process.argv.includes("--query")) void queryVariants();
