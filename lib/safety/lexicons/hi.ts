import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "hi",
  reviewed: false,
  patterns: [
    /आत्म\s*-?\s*हत्या|खुदकुशी/,
    /मरना\s+चाह|मर\s+जाना\s+चाह|मरने\s+का\s+मन/,
    /जीना\s+नहीं\s+चाह|जीने\s+की\s+इच्छा\s+नहीं|जीने\s+का\s+मन\s+नहीं/,
    /अपनी\s+जान\s+ले|अपनी\s+(?:जिंदगी|जिन्दगी|ज़िंदगी|ज़िन्दगी)\s+खत्म/,
    /खुद\s+को\s+(?:खत्म|मार|नुकसान|चोट)/,
    /ओवरडोज|अधिक\s+मात्रा\s+में\s+दवा/,
    /जीने\s+का\s+कोई\s+मतलब\s+नहीं/,
  ],
};
