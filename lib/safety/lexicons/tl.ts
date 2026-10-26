import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "tl",
  reviewed: false,
  patterns: [
    /pakamatay/,
    /\bgusto\s+ko(?:ng)?\s+(?:nang\s+)?(?:mamatay|mawala)\b/,
    /\bayaw\s+ko\s+(?:nang\s+)?mabuhay\b/,
    /\b(?:wakasan|tapusin)\s+ang\s+(?:buhay\s+ko|aking\s+buhay)\b/,
    /\b(?:pa)?patayin\s+(?:ko\s+)?ang\s+(?:aking\s+)?sarili\b/,
    /\bsaktan\s+ang\s+(?:aking\s+)?sarili\b/,
    /\bmas\s+mabuti\s+pang\s+(?:mamatay|patay)\b/,
    /\bwalang\s+saysay\s+ang\s+buhay\b|\bwala\s+nang\s+dahilan\s+para\s+mabuhay\b/,
    /\b(?:nag|mag)-?\s*overdose\b|\bsobrang\s+dosis\b/,
  ],
};
