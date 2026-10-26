export interface CrisisLexicon {
  /** BCP 47 tag. */
  tag: string;
  /** True only after a native or professional review (never for machine-made lexicons). */
  reviewed: boolean;
  /** Regexes written for accent-folded, lowercase text (they are re-normalized when compiled). */
  patterns: readonly RegExp[];
}
