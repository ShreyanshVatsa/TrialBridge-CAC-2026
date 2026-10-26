/**
 * Strict validation of the criterion judge's JSON (prompts/analyze-v3.ts). The model's output is never trusted:
 *  - ids that were not sent are dropped; a sent id the model skipped becomes "unknown" (source "default");
 *  - a label outside the section's set becomes "unknown";
 *  - answerIds must name a numbered answer that exists; met / not_met / excluded with no valid answerId is
 *    downgraded to "unknown";
 *  - reasons are capped at the word limit and pass the same wording filter as every other model text;
 *  - coverage = judged / sent, where "judged" = a sent id that came back with a valid label.
 */
import { z } from "zod";
import { MATCH_JUDGE } from "@/config/match-judge";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import type { CriterionLabel, CriterionLabelValue, ExclusionLabel, InclusionLabel } from "@/lib/types/criteria";
import { NEUTRAL_NOTE, violatesWording } from "../safety";
import { ProviderError } from "./types";

const INCLUSION: readonly InclusionLabel[] = ["met", "not_met", "unknown", "not_applicable"];
const EXCLUSION: readonly ExclusionLabel[] = ["excluded", "not_excluded", "unknown", "not_applicable"];
/** Labels that claim a definite answer and therefore need a cited answer. */
const NEEDS_EVIDENCE: ReadonlySet<CriterionLabelValue> = new Set(["met", "not_met", "excluded"]);
/** TrialGPT's own label words, accepted in case a model echoes them. */
const ALIASES: Readonly<Record<string, string>> = {
  included: "met",
  not_included: "not_met",
  not_enough_information: "unknown",
  not_enough_info: "unknown",
};

export const DOWNGRADE_REASON = "Your answers do not say enough about this.";
export const MISSING_REASON = "Not checked yet. Your care team can review this with you.";

const LooseItem = z.object({
  id: z.coerce.string(),
  label: z.coerce.string(),
  reason: z.coerce.string().optional().catch(undefined),
  answerIds: z.array(z.coerce.string()).optional().catch(undefined),
});
const LooseOutput = z.object({
  trials: z.array(z.object({ trialId: z.coerce.string(), items: z.array(z.unknown()).default([]) })),
});

interface SentTrial {
  trialId: string;
  items: readonly SplitCriterion[];
}

export interface ValidatedTrial {
  trialId: string;
  labels: CriterionLabel[];
  sent: number;
  judged: number;
  downgraded: number;
  dropped: number;
}

function normLabel(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIASES[k] ?? k;
}

export function capWords(text: string, max: number = MATCH_JUDGE.reasonMaxWords): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")}…`;
}

function cleanReason(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = capWords(raw.replace(/[\u0000-\u001f]+/g, " "));
  if (!t) return undefined;
  return violatesWording(t) ? NEUTRAL_NOTE.en : t;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Collect trial answers from whatever shape came back. Seen on gpt-oss-120b (replaying cached completions in data/cache/matching-llm):
 *  - the wrapper closed early and later trials follow it: [{"trials":[T1,T2]}, T3]
 *  - a trial written as loose tokens inside an array: "trialId", ":", "NCT…", "items", ":", [items]
 * Wrappers ({trials}) are flattened, objects with a trialId are taken as they are, and a token run is rebuilt
 * only when it names the trial id itself (never matched by position).
 */
function collectTrials(v: unknown, out: unknown[]): void {
  if (isObj(v)) {
    if ("trialId" in v) out.push(v);
    else if (Array.isArray(v.trials)) collectTrials(v.trials, out);
    return;
  }
  if (!Array.isArray(v)) return;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x !== "trialId") {
      collectTrials(x, out);
      continue;
    }
    let j = i + 1;
    const skipColon = () => {
      if (v[j] === ":") j++;
    };
    skipColon();
    const trialId = v[j];
    if (typeof trialId !== "string") continue;
    j++;
    if (v[j] !== "items") continue;
    j++;
    skipColon();
    if (!Array.isArray(v[j])) continue;
    out.push({ trialId, items: v[j] });
    i = j;
  }
}

/** Parse the first JSON span of raw model text. Throws ProviderError("invalid_output") on non-JSON or wrong shape. */
export function parseMatchJson(raw: string): z.infer<typeof LooseOutput> {
  const obj = raw.indexOf("{");
  const arr = raw.indexOf("[");
  // A top-level array (of trial answers, or wrapping the whole object) is accepted too.
  const isArray = arr >= 0 && arr < obj;
  const start = isArray ? arr : obj;
  const end = raw.lastIndexOf(isArray ? "]" : "}");
  if (start < 0 || end <= start) throw new ProviderError("invalid_output", "no JSON");
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new ProviderError("invalid_output", "malformed JSON");
  }
  // A single-trial answer without the wrapper is accepted too.
  if (isObj(json) && !("trials" in json) && "items" in json) json = { trials: [json] };
  if (Array.isArray(json) || (isObj(json) && Array.isArray(json.trials))) {
    const trials: unknown[] = [];
    collectTrials(json, trials);
    json = { trials };
  }
  const p = LooseOutput.safeParse(json);
  if (!p.success) throw new ProviderError("invalid_output", "schema");
  return p.data;
}

/** Validate one batch's output against exactly what was sent and the numbered answer ids. */
export function validateMatchOutput(raw: string, sent: readonly SentTrial[], answerIds: ReadonlySet<string>): ValidatedTrial[] {
  const out = parseMatchJson(raw);
  const byTrial = new Map<string, unknown[]>();
  for (const t of out.trials) if (!byTrial.has(t.trialId)) byTrial.set(t.trialId, t.items);

  return sent.map((trial) => {
    const sentById = new Map(trial.items.map((c) => [c.id, c]));
    const got = new Map<string, CriterionLabel>();
    let dropped = 0;
    let downgraded = 0;
    for (const rawItem of byTrial.get(trial.trialId) ?? []) {
      const item = LooseItem.safeParse(rawItem);
      if (!item.success) continue;
      const crit = sentById.get(item.data.id.trim().toUpperCase());
      if (!crit) {
        dropped++;
        continue;
      }
      if (got.has(crit.id)) continue; // first answer for an id wins
      const allowed: readonly string[] = crit.section === "inclusion" ? INCLUSION : EXCLUSION;
      const label = normLabel(item.data.label);
      if (!allowed.includes(label)) continue; // wrong label set: treated as not judged
      const cited = [...new Set((item.data.answerIds ?? []).map((a) => a.trim().toUpperCase()).filter((a) => answerIds.has(a)))];
      let value = label as CriterionLabelValue;
      let reason = cleanReason(item.data.reason);
      if (NEEDS_EVIDENCE.has(value) && cited.length === 0) {
        value = "unknown";
        reason = DOWNGRADE_REASON;
        downgraded++;
      }
      got.set(crit.id, { id: crit.id, section: crit.section, label: value, source: "llm", ...(reason ? { reason } : {}), answerIds: cited });
    }
    const labels = trial.items.map((c) => got.get(c.id) ?? { id: c.id, section: c.section, label: "unknown" as const, source: "default" as const, reason: MISSING_REASON, answerIds: [] });
    return { trialId: trial.trialId, labels, sent: trial.items.length, judged: got.size, downgraded, dropped };
  });
}
