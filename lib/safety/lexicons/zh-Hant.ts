import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "zh-Hant",
  reviewed: false,
  patterns: [
    /自殺|自杀/,
    /想死|不想活|不想再活|活不下去|死了算了|不如死了/,
    /結束(?:自己的)?生命|了結生命|輕生|殺死自己|想消失/,
    /活著沒(?:有)?意思|活着沒意思|生活沒有意義/,
    /自殘|割腕|跳樓|吞藥|服毒/,
    /過量服藥|過量的藥|藥物過量|吃了很多藥|結束一切/,
  ],
};
