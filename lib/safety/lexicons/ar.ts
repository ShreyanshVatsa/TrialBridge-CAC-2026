import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "ar",
  reviewed: false,
  patterns: [
    /انتحار|انتحر/,
    /(?:اريد|ابغي|اود|ابي|عايز|بدي)\s+(?:ان\s+)?(?:اموت|انهي\s+حياتي)/,
    /اقتل\s+نفسي|اقتل\s+نفسى/,
    /(?:انهاء|انهي|انهى)\s+حياتي/,
    /لا\s+(?:اريد|اود)\s+(?:ان\s+اعيش|العيش)|لم\s+اعد\s+اريد\s+العيش/,
    /اتمني\s+(?:لو\s+)?(?:اموت|الموت)/,
    /ايذاء\s+نفسي|اوذي\s+نفسي|اؤذي\s+نفسي/,
    /جرعه\s+زائده|جرعة\s+زائدة/,
    /لا\s+فائده\s+من\s+الحياه|الحياه\s+لا\s+تستحق/,
  ],
};
