/**
 * Disease extent a trial is FOR, read from its own title and registered conditions (the sponsor's statement, not a
 * criterion), against the patient's `spread` answer. A ranking signal only (a soft fusion penalty, never a filter):
 *   - a patient whose cancer has spread far gets early-stage-only trials (adjuvant, resectable, localized) lower;
 *   - a patient with cancer that has not spread, or was removed, gets metastatic/advanced-only trials lower.
 * Trials naming both extents, or neither, are neutral, and so is any non-definite spread answer (unknown never lowers).
 * Measured on vignette dev before use: distant + early-only titles 0 relevant of 46 judged; not spread / removed +
 * advanced-only titles 15 relevant of 262 judged.
 */
import type { TrialCard } from "@/lib/types/trial";

const ADVANCED = /\b(?:metastatic|metastases|stage\s*(?:iv|4)[a-c]?|advanced|unresectable|inoperable)\b/i;
const EARLY = /\b(?:early[- ]stage|early breast|locali[sz]ed|adjuvant|neo-?adjuvant|resectable|resected|operable|stage\s*(?:0|i{1,3}|[1-3])[a-c]?(?![\d-])|non-?metastatic|curative|after surgery|post-?operative|ductal carcinoma in situ|DCIS)\b/i;
/** "unresectable" and "inoperable" contain the early words; "locally advanced" is both. */
const EARLY_NEGATED = /\b(?:un|non-?)resectable\b|\binoperable\b|\bnot (?:resectable|operable)\b/gi;

export type TrialExtent = "early" | "advanced" | null;

const cache = new Map<string, TrialExtent>();

/** "early" or "advanced" when the trial's title/conditions name only that extent; null when both, neither. Cached per text. */
export function trialExtent(card: Partial<Pick<TrialCard, "title" | "officialTitle" | "conditions">>): TrialExtent {
  const text = [card.title ?? "", card.officialTitle ?? "", ...(card.conditions ?? [])].join(" ; ");
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const advanced = ADVANCED.test(text);
  const early = EARLY.test(text.replace(EARLY_NEGATED, " "));
  const out: TrialExtent = advanced && !early ? "advanced" : early && !advanced ? "early" : null;
  if (cache.size > 20000) cache.clear();
  cache.set(text, out);
  return out;
}

/** 1 when the trial's own extent contradicts a definite `spread` answer, else 0. */
export function extentConflict(spread: unknown, card: Partial<Pick<TrialCard, "title" | "officialTitle" | "conditions">>): 0 | 1 {
  if (spread !== "distant" && spread !== "not_spread" && spread !== "removed") return 0;
  const extent = trialExtent(card);
  if (spread === "distant") return extent === "early" ? 1 : 0;
  return extent === "advanced" ? 1 : 0;
}
