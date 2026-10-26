/**
 * Hand-checkable assertions for the rule layer (eval/assertions.json): short criterion sentences with the
 * facts a human reader expects. Independent of eval/labels.json (title/condition rules) and
 * eval/facts-labels.json (post-hoc review of extractor output on seed trials).
 * `known` cases are expected to FAIL today; they document real extractor gaps and are never hidden.
 */
import { readFileSync } from "node:fs";
import { factsForCriterion } from "../../lib/ingest/facts";
import type { CriterionSection } from "../../lib/types/trial";

export interface AssertionCase {
  section: CriterionSection;
  text: string;
  expect: Record<string, string>;
  known?: boolean;
}

export interface AssertionOutcome {
  case: AssertionCase;
  got: Record<string, string>;
  pass: boolean;
}

export interface AssertionSummary {
  total: number;
  /** Non-known cases that matched exactly. */
  passed: number;
  /** Non-known cases that did not match (regressions). */
  failed: AssertionOutcome[];
  /** Known gaps that still fail (documented limitation). */
  knownFailing: AssertionOutcome[];
  /** Known gaps that now pass (the `known` flag is stale and should be removed). */
  knownStale: AssertionOutcome[];
}

export function loadAssertionCases(file = "eval/assertions.json"): AssertionCase[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { cases: AssertionCase[] }).cases;
}

const sameFacts = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

export function runAssertions(cases: AssertionCase[]): AssertionSummary {
  const outcomes = cases.map((c): AssertionOutcome => {
    const got = Object.fromEntries(factsForCriterion(c.section, c.text).map((f) => [f.key, f.value]));
    return { case: c, got, pass: sameFacts(got, c.expect) };
  });
  const regular = outcomes.filter((o) => !o.case.known);
  const known = outcomes.filter((o) => o.case.known);
  return {
    total: cases.length,
    passed: regular.filter((o) => o.pass).length,
    failed: regular.filter((o) => !o.pass),
    knownFailing: known.filter((o) => !o.pass),
    knownStale: known.filter((o) => o.pass),
  };
}
