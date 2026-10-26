import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "fr",
  reviewed: false,
  patterns: [
    /suicid/,
    /\bme\s+(?:tuer|suicider)\b/,
    /\bmettre\s+fin\s+a\s+(?:mes\s+jours|ma\s+vie)\b/,
    /\bj'?en\s+ai\s+marre\s+de\s+vivre\b/,
    /\bje\s+veux\s+(?:mourir|crever|disparaitre)\b/,
    /\bje\s+ne\s+veux\s+plus\s+(?:vivre|etre\s+la)\b|\bje\s+n'?ai\s+plus\s+envie\s+de\s+vivre\b/,
    /\bme\s+faire\s+(?:du\s+mal|mal)\b|\bautomutil|\bme\s+blesser\b/,
    /\bmieux\s+(?:mort|morte|sans\s+moi)\b/,
    /\bune\s+(?:surdose|overdose)\b/,
    /\bplus\s+aucune\s+raison\s+de\s+vivre\b|\bla\s+vie\s+ne\s+vaut\s+pas\s+la\s+peine\b/,
  ],
};
