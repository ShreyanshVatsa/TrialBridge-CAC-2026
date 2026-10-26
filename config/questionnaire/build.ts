/** Small builders that keep the catalog files declarative. Data-only helpers, no runtime state. */
import type { FactKey } from "@/lib/types/trial";
import { PREFER_NOT, SKIP, UNKNOWN, type FactRule, type MessageKey, type OptionDef, type OptionEffect, type QuestionDef } from "./types";
import type { QuestionId } from "./ids";

const qk = (q: string, part: "label" | "help" | "why"): MessageKey => `questionnaire.${q}.${part}`;
export const optKey = (q: string, id: string): MessageKey => `questionnaire.${q}.options.${id}`;
export const findOutKey = (q: string): MessageKey => `findOut.${q}.what`;

/** Shared chips for non-response (same matching semantics: no facts, terms or filters). */
const NON_RESPONSE_KEYS: Readonly<Record<string, MessageKey>> = {
  [UNKNOWN]: "questionnaire.common.unknown",
  [SKIP]: "questionnaire.common.skip",
  [PREFER_NOT]: "questionnaire.common.prefer_not",
};

/** Options for a question: its own ids, then "unknown" and "__skip" (+ "prefer_not" when sensitive). */
export function options(q: string, ids: readonly string[], opts: { sensitive?: boolean; essential?: boolean; exclusive?: readonly string[] } = {}): OptionDef[] {
  const own = ids.map((id) => ({ id, labelKey: optKey(q, id), ...(opts.exclusive?.includes(id) ? { exclusiveWith: ids.filter((x) => x !== id) } : {}) }));
  if (opts.essential) return own;
  const tail = [UNKNOWN, SKIP, ...(opts.sensitive ? [PREFER_NOT] : [])].map((id) => ({ id, labelKey: NON_RESPONSE_KEYS[id] as MessageKey }));
  return [...own, ...tail];
}

/** Empty effects for the non-response options. */
export function nonResponseEffects(sensitive = false): OptionEffect[] {
  return [UNKNOWN, SKIP, ...(sensitive ? [PREFER_NOT] : [])].map((option) => ({ option, facts: [] }));
}

/** Patient HAS attribute `fact`: required => support, excluded => conflict. */
export const has = (fact: FactKey, extra: Partial<FactRule> = {}): FactRule => ({ fact, whenRequired: "support", whenExcluded: "conflict", ...extra });
/** Patient LACKS attribute `fact`: required => conflict, excluded => neutral (no penalty, no bonus). */
export const lacks = (fact: FactKey, extra: Partial<FactRule> = {}): FactRule => ({ fact, whenRequired: "conflict", whenExcluded: "neutral", ...extra });

/** Normalize a prior table so it sums to 1, putting the remainder on "unknown". */
export function priors(table: Record<string, number>): Record<string, number> {
  const known = Object.entries(table).filter(([k]) => k !== UNKNOWN);
  const sum = known.reduce((s, [, v]) => s + v, 0);
  const unknown = table[UNKNOWN] ?? Math.max(0, 1 - sum);
  const total = sum + unknown;
  return Object.fromEntries([...known.map(([k, v]) => [k, Number((v / total).toFixed(4))]), [UNKNOWN, Number((unknown / total).toFixed(4))]]);
}

/** A question with the conventional key layout (label/help/why under questionnaire.<keyBase>.*). */
export function question(def: Omit<QuestionDef, "labelKey" | "helpKey" | "whyKey" | "area"> & { keyBase?: string }): QuestionDef {
  const base = def.keyBase ?? def.id;
  const { keyBase: _ignored, ...rest } = def;
  void _ignored;
  return { area: "cancer", labelKey: qk(base, "label"), helpKey: qk(base, "help"), whyKey: qk(base, "why"), ...rest };
}

export type { QuestionId };
