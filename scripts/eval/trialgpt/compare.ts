/**
 * Gold check for lib/ingest/criteria-split.ts against TrialGPT's pre-split criteria (trial_info.json).
 *
 * TrialGPT items are the "\n\n"-separated chunks of its inclusion_criteria / exclusion_criteria strings (its own
 * parse_criteria drops chunks under 5 characters and the "inclusion/exclusion criteria" header chunks; we do the
 * same, but drop a header chunk only when it is header-sized, not any criterion that mentions the phrase).
 * Those items are flat: every bullet at every depth, and every label line, is its own item. So the gold is
 * compared with our flat `splitSegments` layer; `splitCriteria` groups nested lists by design
 * and its agreement is reported separately for reference.
 *
 * Boundary F1: an item boundary is identified by the first 8 normalized word tokens of the item (plus an
 * occurrence counter), so it survives small wording drift; precision/recall are micro-averaged over trials.
 */
import { splitCriteria, splitSegments } from "../../../lib/ingest/criteria-split";
import { unescapeMarkdown } from "../../../lib/ingest/parse";

export interface GoldItems {
  inclusion: string[];
  exclusion: string[];
}

/** Header chunks: the phrase at the start of a short chunk ("inclusion criteria - HL participant:"). */
const HEADER_CHUNK = /^\W*(?:key\s+|main\s+|general\s+)?(?:inclusion|exclusion)\s+criteria\b.{0,80}$/i;

/** Gold items from TrialGPT's section strings. */
const isGoldHeader = (x: string) => HEADER_CHUNK.test(x) && (x.endsWith(":") || x.length <= 40 || /^\W*\w+\s+criteria\W*(?:\(|for\b|-)/i.test(x));

export function goldItems(g: { inclusion: string; exclusion: string }): GoldItems {
  const items = (s: string) =>
    s
      .split("\n\n")
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter((x) => x.length >= 5 && !isGoldHeader(x));
  return { inclusion: items(g.inclusion), exclusion: items(g.exclusion) };
}

export const tokens = (s: string): string[] => unescapeMarkdown(s).toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Flat segments of our splitter in the gold's granularity (connectors and <5-char units dropped, like the gold). */
export function oursFlat(raw: string): GoldItems {
  // Our header lines are kept or dropped by the same rule as the gold's header chunks.
  const segs = splitSegments(raw).filter((s) => s.kind !== "connector" && s.text.replace(/\s+/g, " ").trim().length >= 5 && !(s.kind === "header" && (s.hasRest || isGoldHeader(s.text))));
  return { inclusion: segs.filter((s) => s.section === "inclusion").map((s) => s.text), exclusion: segs.filter((s) => s.section === "exclusion").map((s) => s.text) };
}

export function oursGrouped(raw: string): GoldItems {
  const c = splitCriteria(raw);
  return { inclusion: c.filter((x) => x.section === "inclusion").map((x) => x.text), exclusion: c.filter((x) => x.section === "exclusion").map((x) => x.text) };
}

function startKeys(items: string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const it of items) {
    const k = tokens(it).slice(0, 8).join(" ");
    if (!k) continue;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.push(`${k}#${n}`);
  }
  return out;
}

/** Boundary true positives / predicted / gold counts, sections pooled (the gold sometimes puts both in inclusion). */
export function boundaryCounts(ours: GoldItems, gold: GoldItems): { tp: number; pred: number; gold: number } {
  const o = startKeys([...ours.inclusion, ...ours.exclusion]);
  const g = new Map<string, number>();
  for (const k of startKeys([...gold.inclusion, ...gold.exclusion])) g.set(k, (g.get(k) ?? 0) + 1);
  let tp = 0;
  for (const k of o) {
    const n = g.get(k) ?? 0;
    if (n > 0) {
      tp++;
      g.set(k, n - 1);
    }
  }
  return { tp, pred: o.length, gold: [...gold.inclusion, ...gold.exclusion].filter((x) => tokens(x).length).length };
}

/** Bigram-set Jaccard of the whole text: a proxy for "the registry text did not change since TrialGPT's snapshot". */
export function textSimilarity(a: string, b: string): number {
  const bg = (s: string) => {
    const t = tokens(s);
    const set = new Set<string>();
    for (let i = 0; i + 1 < t.length; i++) set.add(`${t[i]} ${t[i + 1]}`);
    return set;
  };
  const A = bg(a);
  const B = bg(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export interface TrialResult {
  id: string;
  sim: number;
  gold: number;
  flat: number;
  grouped: number;
  flatSectionsExact: boolean;
  tp: number;
  pred: number;
  goldB: number;
}

export function compareTrial(id: string, raw: string, g: { inclusion: string; exclusion: string }): TrialResult {
  const gold = goldItems(g);
  const flat = oursFlat(raw);
  const grouped = oursGrouped(raw);
  const goldN = gold.inclusion.length + gold.exclusion.length;
  const b = boundaryCounts(flat, gold);
  return {
    id,
    sim: textSimilarity(raw, `${g.inclusion}\n${g.exclusion}`),
    gold: goldN,
    flat: flat.inclusion.length + flat.exclusion.length,
    grouped: grouped.inclusion.length + grouped.exclusion.length,
    flatSectionsExact: flat.inclusion.length === gold.inclusion.length && flat.exclusion.length === gold.exclusion.length,
    tp: b.tp,
    pred: b.pred,
    goldB: b.gold,
  };
}

export interface Summary {
  trials: number;
  flatExact: number;
  flatSectionsExact: number;
  flatWithin1: number;
  groupedExact: number;
  precision: number;
  recall: number;
  f1: number;
}

export function summarize(rs: TrialResult[]): Summary {
  const n = rs.length || 1;
  const tp = rs.reduce((s, r) => s + r.tp, 0);
  const pred = rs.reduce((s, r) => s + r.pred, 0);
  const gold = rs.reduce((s, r) => s + r.goldB, 0);
  const p = pred ? tp / pred : 0;
  const rc = gold ? tp / gold : 0;
  return {
    trials: rs.length,
    flatExact: rs.filter((r) => r.flat === r.gold).length / n,
    flatSectionsExact: rs.filter((r) => r.flatSectionsExact).length / n,
    flatWithin1: rs.filter((r) => Math.abs(r.flat - r.gold) <= 1).length / n,
    groupedExact: rs.filter((r) => r.grouped === r.gold).length / n,
    precision: p,
    recall: rc,
    f1: p + rc ? (2 * p * rc) / (p + rc) : 0,
  };
}
