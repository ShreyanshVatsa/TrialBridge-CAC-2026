import {
  DISABILITY_PATTERNS,
  ENGLISH_ALTERNATIVE,
  ENGLISH_EXCEPTION,
  LANGUAGE_NAMES,
  ENGLISH_REQUIRED_EXCLUSION,
  ENGLISH_REQUIRED_INCLUSION,
  MEDICAL_REASON,
  UPPER_AGE_LIMIT_THRESHOLD,
} from "@/config/barriers";
import type { Barrier, Criterion, CriterionRef, CriterionSection } from "@/lib/types/trial";

/**
 * Split a criterion into sentences (on ". " / "; " / newlines) so a barrier quote is the exact
 * triggering sentence rather than a whole long criterion. Each returned piece is a verbatim substring.
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;])\s+(?=[A-Z(])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when a sentence offers another language, interpreters, lists several languages, or states an exception. */
function offersOtherLanguage(s: string): boolean {
  if (ENGLISH_ALTERNATIVE.test(s) || ENGLISH_EXCEPTION.test(s)) return true;
  const langs = new Set((s.match(LANGUAGE_NAMES) ?? []).map((l) => l.toLowerCase()));
  return langs.size >= 2;
}

function firstMatch(section: CriterionSection, list: Criterion[], test: (sentence: string) => boolean): (CriterionRef & { quote: string }) | null {
  for (const c of list) {
    for (const s of sentences(c.text)) if (test(s)) return { section, n: c.n, quote: s };
  }
  return null;
}

interface BarrierInput {
  inclusion: Criterion[];
  exclusion: Criterion[];
  maxAge: number | null;
  /** Lower age limit; when provided, pediatric/AYA trials (minAge < 18 or unknown) are not given an upper-age barrier. */
  minAge?: number | null;
  /** Original structured field, e.g. "70 Years", used as the quote for age barriers. */
  maxAgeRaw?: string;
}

/** Detect access barriers. Returns at most one flag per barrier type, each with its exact quote. */
export function detectBarriers(t: BarrierInput): Barrier[] {
  const out: Barrier[] = [];

  const english =
    firstMatch("inclusion", t.inclusion, (s) => ENGLISH_REQUIRED_INCLUSION.some((re) => re.test(s)) && !offersOtherLanguage(s)) ??
    firstMatch("exclusion", t.exclusion, (s) => ENGLISH_REQUIRED_EXCLUSION.some((re) => re.test(s)) && !offersOtherLanguage(s));
  if (english) out.push({ type: "english_required", quote: english.quote, ref: { section: english.section, n: english.n } });

  const adultIntended = t.minAge === undefined || (t.minAge !== null && t.minAge >= 18);
  if (t.maxAge !== null && t.maxAge < UPPER_AGE_LIMIT_THRESHOLD && adultIntended) {
    out.push({ type: "upper_age_limit", quote: `Maximum age: ${t.maxAgeRaw ?? `${t.maxAge} Years`}` });
  }

  const disability = firstMatch("exclusion", t.exclusion, (s) => DISABILITY_PATTERNS.some((re) => re.test(s)) && !MEDICAL_REASON.test(s));
  if (disability) out.push({ type: "disability_exclusion", quote: disability.quote, ref: { section: disability.section, n: disability.n } });

  return out;
}
