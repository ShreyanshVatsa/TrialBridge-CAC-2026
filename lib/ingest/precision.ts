/**
 * Precision summary for labeled fact samples (eval/facts-labels-v2.json). Pure; used by
 * scripts/ingest/fact-precision.ts and unit-tested.
 */
import type { FactParam, FactValue } from "@/lib/types/trial";

/** The precision gate (QUESTIONNAIRE_SPEC §7.3): penalize only at >= 85%. */
export const PRECISION_GATE = 0.85;
/** Minimum labeled items for a pass (a family with fewer directional facts in the data must label all of them). */
const MIN_LABELED = 30;

export interface LabelItem {
  n?: number;
  id: string;
  key: string;
  value: FactValue;
  param?: FactParam;
  /** "I3" = inclusion 3, "E5" = exclusion 5. */
  ref: string;
  quote: string;
  /** Label (provisional): is (key, value, param) a reasonable reading of the quote? null = not labeled yet. */
  correct: boolean | null;
  why?: string;
  /** Sampling round (1 = development sample, 2 = fresh held-out sample after rule fixes). */
  round?: number;
}

export interface LabelFile {
  note: string;
  /** How the held-out round was drawn (seed, partition, exclusions); see scripts/ingest/fact-precision.ts. */
  protocol?: string;
  source: string;
  /** Rounds that count toward the reported precision per family (default: the latest round labeled). */
  families: Record<string, { items: LabelItem[]; measureRound?: number; poolSize?: number }>;
}

interface FamilySummary {
  family: string;
  labeled: number;
  correct: number;
  precision: number;
  /** Labeled items the current extractor no longer produces with the same value/param (need relabeling). */
  stale: number;
  passes: boolean;
}

/**
 * Precision per family over labeled items of the measured round. `current` returns what the extractor
 * produces today for the item's trial/key/criterion (null = no fact): changed items count as stale and
 * are excluded, so the number always describes the current rules.
 */
export function summarizePrecision(labels: LabelFile, current: (it: LabelItem) => { value: FactValue; param?: FactParam } | null): FamilySummary[] {
  const out: FamilySummary[] = [];
  for (const [family, { items, measureRound, poolSize }] of Object.entries(labels.families)) {
    const rounds = items.filter((i) => i.correct !== null).map((i) => i.round ?? 1);
    const round = measureRound ?? (rounds.length ? Math.max(...rounds) : 1);
    let labeled = 0;
    let correct = 0;
    let stale = 0;
    for (const it of items) {
      if ((it.round ?? 1) !== round || it.correct === null) continue;
      const now = current(it);
      if (!now || now.value !== it.value || now.param !== it.param) {
        stale++;
        continue;
      }
      labeled++;
      if (it.correct) correct++;
    }
    const precision = labeled ? correct / labeled : 0;
    const enough = labeled >= Math.min(MIN_LABELED, poolSize ?? MIN_LABELED);
    out.push({ family, labeled, correct, precision, stale, passes: enough && precision >= PRECISION_GATE });
  }
  return out.sort((a, b) => a.family.localeCompare(b.family));
}

/** Deterministic dev/held partition of trials by NCT id (FNV-1a hash). Rules and LLM thresholds are tuned on "dev" only. */
export function partitionOf(id: string): "dev" | "held" {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return (h >>> 7) % 2 === 0 ? "dev" : "held";
}
