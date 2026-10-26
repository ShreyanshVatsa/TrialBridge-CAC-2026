import type { CrisisLexicon } from "../types";

export const lexicon: CrisisLexicon = {
  tag: "ht",
  reviewed: false,
  patterns: [
    /\bsw?u?i[sc]id/,
    /\bswisid/,
    /\btouye\s+(?:tet\s+)?(?:mwen|m)\b/,
    /\bmwen\s+(?:vle|ta\s+renmen)\s+mouri\b/,
    /\bmwen\s+pa\s+(?:vle|anvi)\s+viv\b/,
    /\b(?:fini|mete\s+fen)\s+(?:ak|nan|a)\s+(?:lavi|vi)\s+(?:mwen|m)\b|\bmet\s+fen\s+(?:nan\s+|a\s+|ak\s+)?(?:lavi|vi)\s+mwen\b/,
    /\bpran\s+lavi\s+mwen\b|\bmwen\s+vle\s+fini\s+ak\s+(?:tout\s+bagay|lavi)\b/,
    /\bfe\s+(?:tet\s+)?(?:mwen|m)\s+mal\b/,
    /\b(?:pi\s+bon|mye)\s+mwen\s+mouri\b/,
    /\boverdoz\b/,
  ],
};
