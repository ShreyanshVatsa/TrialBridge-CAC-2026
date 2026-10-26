import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "ru",
  reviewed: false,
  patterns: [
    /самоубийств|суицид/,
    /покончить\s+с\s+(?:собой|жизнью|всем)/,
    /убить\s+себя/,
    /хочу\s+умереть|лучше\s+бы\s+я\s+умер|лучше\s+умереть/,
    /не\s+хочу\s+(?:больше\s+)?жить|жить\s+не\s+хочу/,
    /свести\s+счеты\s+с\s+жизнью|лишить\s+себя\s+жизни/,
    /причинить\s+себе\s+вред|навредить\s+себе|самоповрежд|порезать\s+себя/,
    /передозировк/,
    /нет\s+смысла\s+жить|незачем\s+жить/,
  ],
};
