/**
 * Access-barrier rules (rule-based, transparent, versioned). Each flag stores the exact
 * triggering sentence. See lib/ingest/barriers.ts for how they are applied.
 */

/** Upper age limit below this (years) is flagged. */
export const UPPER_AGE_LIMIT_THRESHOLD = 75;

/** Inclusion sentences requiring English. */
export const ENGLISH_REQUIRED_INCLUSION = [
  /\b(able|ability|willing|willingness|capable)\b[^.;]{0,60}\b(read|speak|write|understand|communicate|comprehend)\b[^.;]{0,40}\benglish\b/i,
  /\benglish[- ]speaking\b/i,
  /\b(fluent|fluency|proficient|proficiency|literate|literacy)\b[^.;]{0,20}\benglish\b/i,
  /\benglish\b[^.;]{0,10}\b(fluency|proficiency|literacy|speaker)\b/i,
  /\b(speak|read|understand)s?\b[^.;]{0,15}\benglish\b/i,
];

/** Exclusion sentences excluding non-English speakers. */
export const ENGLISH_REQUIRED_EXCLUSION = [
  /\b(unable|inability|not able|cannot|can ?not)\b[^.;]{0,40}\b(read|speak|write|understand|communicate)\b[^.;]{0,40}\benglish\b/i,
  /\bnon[- ]english[- ]speak/i,
  /\bdo(es)? not (speak|read|understand)\b[^.;]{0,15}\benglish\b/i,
];

/** If a sentence offers another language or interpreters, it is not an English-only requirement. */
export const ENGLISH_ALTERNATIVE = /\b(or|and\/or)\s+(spanish|another language|other languages?|chinese|french|portuguese)\b|\bspanish\s+or\b|\binterpret(er|ation)|\btranslat(ed|ion|or)\b|\bany language\b/i;

/** Names of languages: a sentence that lists two or more of them is not an English-only requirement. */
export const LANGUAGE_NAMES = /\b(english|spanish|french|german|russian|mandarin|chinese|cantonese|vietnamese|portuguese|korean|arabic|hindi|japanese|italian|tagalog|polish|creole|haitian|urdu|bengali|farsi|persian|hebrew|greek|turkish|armenian)\b/gi;
/** "may be registered/enrolled without ..." style exceptions. */
export const ENGLISH_EXCEPTION = /\bmay (still )?be (registered|enrolled|included|considered|eligible)\b|\b(exception|waived?)\b/i;

/** Exclusion sentences referencing disability or impairment. */
export const DISABILITY_PATTERNS = [
  /\b(with|having|has|have|of)\s+(an?\s+|any\s+)?(physical|intellectual|cognitive|learning|developmental|mental|severe)?\s*(disabilit(y|ies)|handicap)\b/i,
  /\bdisabled\b/i,
  /\bwheelchair/i,
  /\b(blind|blindness|deaf|deafness)\b/i,
  /\b(hearing|visual|vision|cognitive|intellectual|mental)(ly)?\s+(impair|disab|deficit|incapac)/i,
  /\bdementia\b/i,
  /\b(psychiatric|mental) (illness|disorder|condition)s?\b/i,
  /\bunable to (walk|ambulate)\b/i,
];

/**
 * A stated medical reason makes the exclusion medically justified (not flagged).
 * Compliance/logistics reasons ("would limit compliance") are NOT medical reasons.
 */
export const MEDICAL_REASON =
  /\b(safety|toxicit(y|ies)|adverse|risk of|neuropath|grade\s*[1-5]|ctcae|seizure|due to (the )?(disease|tumou?r|cancer|metastas)|secondary to|caused by|brain metastas|cns (involvement|metastas)|interfere with (the )?(assessment|evaluation)|uncontrolled)\b/i;
