/**
 * Display-only excerpt of a criterion quote: long registry criteria (one "item" can hold a whole numbered list) are cut
 * to the clause that carries the matched fact, so a result card shows one readable line with the full text one click
 * away. Never used for matching; the full verbatim text always stays available.
 */

/** Default visible length of an excerpt, in characters (an ellipsis may be added on either side). */
export const EXCERPT_MAX = 220;

/** Words that identify a fact family inside criterion text, keyed by a fragment of the fact key. */
const HINTS: readonly [RegExp, RegExp][] = [
  [/ecog|performance|karnofsky/, /\b(?:ecog|karnofsky|performance status|kps)\b/i],
  [/brain/, /\b(?:brain|cns|leptomeningeal)\b/i],
  [/measurable/, /\b(?:measurable|recist)\b/i],
  [/lines|treated|newly_diagnosed|prior/, /\b(?:prior|previous(?:ly)?|lines?|regimens?|treated|treatment|therapy|na[iï]ve|newly diagnosed)\b/i],
  [/metastatic|locally_advanced|stage|adjuvant|resectable|spread/, /\b(?:metasta\w*|stage|advanced|unresectable|resectable|adjuvant|recurren\w*)\b/i],
  [/her2/, /\bher-?2\b/i],
  [/\bhr\b|biomarker:hr|estrogen|progesterone/, /\b(?:hormone receptor|hr[+-]?|er[+-]?|pr[+-]?|estrogen|progesterone)\b/i],
  [/hiv/, /\bhiv\b/i],
  [/hepatitis/, /\b(?:hepatitis|hbv|hcv)\b/i],
  [/autoimmune/, /\bautoimmune\b/i],
  [/transplant|allo_sct/, /\btransplant\w*\b/i],
  [/other_malignancy/, /\b(?:malignanc\w*|cancer)\b/i],
  [/heart|cardiac/, /\b(?:heart|cardiac|myocardial)\b/i],
  [/kidney|renal/, /\b(?:kidney|renal|creatinine)\b/i],
  [/liver|hepatic/, /\b(?:liver|hepatic|bilirubin)\b/i],
  [/pregnan/, /\b(?:pregnan\w*|breast-?feeding|lactating)\b/i],
  [/concurrent_trial/, /\b(?:another|other) (?:clinical )?(?:trial|study)\b/i],
  [/histology/, /\b(?:histolog\w*|confirmed|carcinoma|adenocarcinoma|squamous)\b/i],
];

/** A regex for the words of a fact key ("biomarker:egfr" -> /\begfr\b/i), or null when the key has no usable word. */
function hintFor(key: string | undefined): RegExp | null {
  if (!key) return null;
  const k = key.toLowerCase();
  for (const [keyRe, textRe] of HINTS) if (keyRe.test(k)) return textRe;
  const word = k.split(/[:_]/).pop() ?? "";
  return word.length >= 3 ? new RegExp(`\\b${word.replace(/[^a-z0-9]/g, "")}`, "i") : null;
}

/** Clauses of a criterion: sentences, "; " parts, "* " bullets and numbered list items, trimmed, empty ones dropped. */
export function clauses(text: string): string[] {
  return text
    .split(/(?<=[^\s\d][.;:])\s+(?=[A-Z0-9*•(])|\s+[*•]\s+|\n+|\s+(?=\d{1,2}[.)]\s+[A-Z])/)
    .map((c) => c.replace(/^[*•]\s*/, "").trim())
    .filter((c) => c.length > 0);
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

export interface QuoteExcerpt {
  /** What to show by default. */
  text: string;
  /** True when `text` is not the whole quote (show a "full criterion" disclosure). */
  partial: boolean;
}

/**
 * The excerpt to show for a quote: the whole quote when it is short; otherwise the first clause that mentions the fact
 * named by `key` (or the first clause), clipped to `max` characters, with a leading ellipsis when it starts mid-text.
 */
export function focusQuote(quote: string, key?: string, max = EXCERPT_MAX): QuoteExcerpt {
  const text = quote.trim();
  if (text.length <= max + 20) return { text, partial: false };
  const parts = clauses(text);
  const hint = hintFor(key);
  const idx = Math.max(0, hint ? parts.findIndex((c) => hint.test(c)) : 0);
  const chosen = parts[idx] ?? text;
  const body = clip(chosen, max);
  return { text: idx > 0 ? `… ${body}` : body, partial: true };
}
