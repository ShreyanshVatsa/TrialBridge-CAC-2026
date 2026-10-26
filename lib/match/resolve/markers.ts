/** Marker lists under a negation, and inclusion alternatives checked option by option. Part of the criterion resolver (./index.ts). */
import { BIOMARKERS } from "@/config/biomarkers";
import { MARKER_QUALIFIER } from "../marker-qualifier";
import { factsForCriterion } from "@/lib/ingest/facts";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import type { ResolverProfile, ResolveContext } from "./profile";
import { type Verdict, checkFact } from "./facts";
import { checkStage } from "./stage";
import { checkTreated } from "./treated";
import { BENIGN_OR, stripDefinitions, msiDirection } from "./text";

/** "without EGFR, ALK, or ROS1 alterations", "negative for EGFR mutation/ALK translocation", "no known alterations in NTRK, BRAF ...". */
export const NEGATED_LIST = /\b(?:without|negative for|no known|no documented|no evidence of|does not have|do not have|must not have|not harbou?r\w*|absence of|lack(?:ing|s)? of|wild[- ]?type for|free of)\s+(?:a\s+|an\s+|any\s+|known\s+|documented\s+|actionable\s+|targetable\s+|tumou?r\s+|genomic\s+)*((?:[^.;:]){3,160})/gi;
/** Qualifiers that keep a marker open even in a negated list (a specific variant, resistance, exon 20 insertion). */
export const NEGATED_LIST_QUALIFIER = /\b(?:other than|besides|aside from|except|resistan\w*|exon\s*20|insertions?|co-?mutations?|acquired|variants? of unknown)\b|\b[A-Z]\d{2,4}[A-Z*]\b/i;
/**
 * Markers named in a negated list of an inclusion item: each one is required to be absent (the "or" is a conjunction).
 * Returns biomarker keys; the caller adds `excluded` facts for them.
 */
export function negatedMarkers(section: SplitCriterion["section"], text: string): { keys: string[]; altText: string } {
  if (section !== "inclusion") return { keys: [], altText: text };
  const out = new Set<string>();
  let altText = text;
  for (const m of text.matchAll(NEGATED_LIST)) {
    const span = m[1] ?? "";
    if (NEGATED_LIST_QUALIFIER.test(span)) continue;
    const head = span.slice(0, 120);
    let found = false;
    for (const b of BIOMARKERS) {
      if (!b.pattern.test(head)) continue;
      out.add(b.id);
      found = true;
    }
    // Inside a negated marker list the "or" is a conjunction: that span is left out of the alternatives check.
    if (found) altText = altText.replace(m[0], " ");
  }
  return { keys: [...out].map((id) => `biomarker:${id}`), altText };
}

/** Top-level alternatives of an inclusion item (definitions and benign pairs removed), or null when it has none. */
export function splitAlternatives(text: string): string[] | null {
  let t = text;
  for (const re of BENIGN_OR) t = t.replace(re, " ");
  t = stripDefinitions(t);
  for (const re of BENIGN_OR) t = t.replace(re, " ");
  if (/\b(?:either|one of the following|any of the following|at least one of)\b/i.test(t)) return null;
  const parts = t.split(/\s*(?:,\s*)?\b(?:or|and\/or)\b\s*/i).map((x) => x.trim()).filter((x) => x.length >= 4);
  return parts.length >= 2 && parts.length <= 4 ? parts : null;
}

/** The directional, resolver-settled facts of one clause as verdicts (biomarkers, histology, MSI wording, stage, treated status). */
export function clauseVerdicts(clause: string, p: ResolverProfile, ctx: ResolveContext): Verdict[] {
  const out: Verdict[] = [];
  const facts = factsForCriterion("inclusion", clause, { v2: true, groups: ctx.groups, ...(ctx.conditions ? { conditions: ctx.conditions } : {}) });
  const msi = msiDirection("inclusion", clause);
  if (msi && !facts.some((f) => f.key === "biomarker:MSI-H" && f.value !== "mentioned")) facts.push({ key: "biomarker:MSI-H", value: msi });
  for (const f of facts) {
    if (f.value === "mentioned" || !(f.key.startsWith("biomarker:") || f.key.startsWith("histology:"))) continue;
    if (f.key.startsWith("biomarker:") && MARKER_QUALIFIER.test(clause)) continue;
    out.push(checkFact(f, p));
  }
  const stage = checkStage(clause, p, "inclusion");
  if (stage) out.push(stage.verdict);
  const treated = checkTreated(clause, p, "inclusion");
  if (treated) out.push(treated.verdict);
  return out;
}

/**
 * An inclusion item with alternatives is not met when EVERY option fails on a checked fact ("HER2-positive or
 * triple-negative breast cancer" for an HR-positive, HER2-negative patient). An option with nothing checkable, or with
 * an open verdict, keeps the item unknown.
 */
export function allAlternativesFail(text: string, p: ResolverProfile, ctx: ResolveContext): boolean {
  const parts = splitAlternatives(text);
  if (!parts) return false;
  // A negation before the first option scopes over all of them ("no known X or Y"): the split would misread it.
  if (/\b(?:no|not|without|absence|neither|lack|free of|negative for)\b/i.test(parts[0] as string)) return false;
  return parts.every((clause) => {
    const v = clauseVerdicts(clause, p, ctx);
    return v.length > 0 && v.some((x) => x === "fail") && !v.some((x) => x === "open");
  });
}
