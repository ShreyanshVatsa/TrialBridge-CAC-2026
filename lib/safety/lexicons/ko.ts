import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "ko",
  reviewed: false,
  patterns: [
    /자살/,
    /죽고\s*싶|죽을\s*것\s*같|죽어\s*버리|사라지고\s*싶/,
    /살고\s*싶지\s*않|살기\s*싫|살\s*이유가\s*없/,
    /삶을\s*끝|목숨을\s*끊|스스로\s*목숨|극단적\s*선택/,
    /자해|손목을\s*긋/,
    /과다\s*복용|약을\s*과다/,
  ],
};
