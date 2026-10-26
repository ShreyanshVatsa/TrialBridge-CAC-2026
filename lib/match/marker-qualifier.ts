/**
 * Biomarker wording narrower than a positive/negative answer: "other than EGFR", "EGFR mutations that cause
 * resistance to osimertinib", "exon 20 insertion", "T790M". A positive or negative test result does not settle
 * these (seen on NCT07315113). Shared by the per-criterion resolver and the pre-check.
 */
export const MARKER_QUALIFIER = /\b(?:other than|besides|aside from|except|resistan\w*|exon\s*\d+|insertions?|deletions?|co-?mutations?|acquired|sensitizing|activating|variants? of unknown)\b|\b[A-Z]\d{2,4}[A-Z*]\b/i;

/** A biomarker fact whose quote carries qualifier wording: never a conflict or support from a plain test result. */
export const qualifiedMarkerFact = (f: { key: string; quote?: string }): boolean => f.key.startsWith("biomarker:") && !!f.quote && MARKER_QUALIFIER.test(f.quote);
