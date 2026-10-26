/**
 * "Find out at your next appointment" items (QUESTIONNAIRE_SPEC §5.3): one per question that has a
 * `findOutKey`. Each says what to ask, where to look, and why it matters. Never sent anywhere.
 */
import type { FindOutDef, MessageKey } from "./types";

const item = (id: string): FindOutDef => ({ whatKey: `findOut.${id}.what` as MessageKey, whereKey: `findOut.${id}.where` as MessageKey, whyKey: `findOut.${id}.why` as MessageKey });

/** Keyed by the id used in a question's findOutKey (`findOut.<id>.what`). */
export const FIND_OUT_ITEMS: Readonly<Record<string, FindOutDef>> = Object.freeze({
  spread: item("spread"),
  subtype: item("subtype"),
  biomarkers: item("biomarkers"),
  lines: item("lines"),
  daily_activity: item("daily_activity"),
  brain_mets: item("brain_mets"),
  measurable: item("measurable"),
  prior_drugs: item("prior_drugs"),
  "group_status.prostate": item("group_status.prostate"),
  "group_status.ovarian": item("group_status.ovarian"),
  "group_status.bladder": item("group_status.bladder"),
  "group_status.myeloma": item("group_status.myeloma"),
  "group_status.pancreatic": item("group_status.pancreatic"),
  "group_status.thyroid": item("group_status.thyroid"),
});

/** The find-out id behind a question's findOutKey (`findOut.<id>.what` -> `<id>`). */
export function findOutId(findOutKey: string): string {
  return findOutKey.replace(/^findOut\./, "").replace(/\.what$/, "");
}
