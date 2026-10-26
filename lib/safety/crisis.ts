/**
 * Shared crisis detection (browser pre-check and server): docs/dev/QUESTIONNAIRE_SPEC.md section 6.7.
 * Conservative by design: it runs EVERY available lexicon on the normalized text, whatever the UI locale,
 * so English words embedded in other-language text, or a language without its own lexicon, still match.
 * A false positive only shows a supportive box with phone numbers; the always-visible 988/911 line is
 * the guarantee on a miss.
 */
import { LEXICONS } from "./lexicons";
import { compilePattern, normalizeForCrisis } from "./normalize";

export { normalizeForCrisis };

const COMPILED: ReadonlyMap<string, readonly RegExp[]> = new Map(Object.entries(LEXICONS).map(([tag, l]) => [tag, l.patterns.map(compilePattern)]));
const ALL: readonly RegExp[] = [...COMPILED.values()].flat();

export function crisisLocaleTags(): string[] {
  return [...COMPILED.keys()];
}

/** True when any lexicon matches. `only` restricts to one locale's lexicon (tests). */
export function matchesCrisis(text: string, only?: string): boolean {
  const t = normalizeForCrisis(text);
  if (only) return (COMPILED.get(only) ?? []).some((re) => re.test(t));
  return ALL.some((re) => re.test(t));
}
