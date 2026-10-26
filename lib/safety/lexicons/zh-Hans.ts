import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "zh-Hans",
  reviewed: false,
  patterns: [
    /自杀|自殺/,
    /想死|不想活|不想再活|活不下去|死了算了|不如死了/,
    /结束(?:自己的)?生命|了结生命|轻生|杀死自己|想消失/,
    /活着没(?:有)?意思|活着没意义|生活没有意义/,
    /自残|割腕|跳楼|吞药|服毒/,
    /过量服药|过量的药|药物过量|吃了很多药|结束一切/,
  ],
};
