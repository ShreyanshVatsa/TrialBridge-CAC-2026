/**
 * Data-minimization check helpers (QUESTIONNAIRE_SPEC §4.3), used by unit tests and the e2e network test:
 * given the body of an outgoing /api/* request, list everything in it that must never leave the browser.
 */

/**
 * Keys that must never appear anywhere in a request body (raw questionnaire ids and legacy intake names). The
 * health-history answers may be sent, but only under their minimized names (hivStatus, organProblems, ...), so the
 * raw ids below still must not appear.
 */
export const BROWSER_ONLY_KEYS: readonly string[] = [
  "zip",
  "travel",
  "travelMiles",
  "age",
  "sex",
  "hiv",
  "hepatitis",
  "transplant",
  "autoimmune",
  "organ_problems",
  "other_cancer",
  "measurable",
  "phase_pref",
  "pregnancy",
  "in_other_trial",
  "deferred",
  "findOut",
  "gains",
  "history",
  "answers",
  "questionnaire",
];

function collectKeys(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) for (const x of v) collectKeys(x, out);
  else if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      collectKeys(x, out);
    }
}

function collectNumbers(v: unknown, out: number[]): void {
  if (typeof v === "number") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectNumbers(x, out);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) collectNumbers(x, out);
}

/**
 * Problems found in a request body: forbidden keys, the ZIP code anywhere in the text, the exact age as a
 * number, and any of `values` (e.g. distinctive sensitive answers) anywhere in the text. [] = clean.
 */
export function findPrivacyLeaks(body: string, secrets: { zip?: string; age?: number; values?: readonly string[] } = {}): string[] {
  const problems: string[] = [];
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* not JSON: text checks still apply */
  }
  const keys = new Set<string>();
  collectKeys(parsed, keys);
  for (const k of BROWSER_ONLY_KEYS) if (keys.has(k)) problems.push(`key:${k}`);
  if (secrets.zip && body.includes(secrets.zip)) problems.push("zip");
  if (secrets.age !== undefined) {
    const nums: number[] = [];
    collectNumbers(parsed, nums);
    if (nums.includes(secrets.age)) problems.push("age");
  }
  for (const v of secrets.values ?? []) if (v && body.includes(v)) problems.push(`value:${v}`);
  return problems;
}
