import type { CrisisLexicon } from "../types";

export const lexicon: CrisisLexicon = {
  tag: "pt",
  reviewed: false,
  patterns: [
    /suicid/,
    /\bme\s+matar\b/,
    /\b(?:tirar|acabar\s+com)\s+(?:a\s+)?(?:minha|propria)\s+(?:propria\s+)?vida\b|acabar\s+com\s+a\s+minha\s+vida/,
    /\bacabar\s+com\s+tudo\b/,
    /\bquero\s+(?:morrer|desaparecer)\b|\bquero\s+acabar\s+com\s+(?:a\s+minha|minha)\s+vida/,
    /\bnao\s+quero\s+(?:mais\s+)?(?:viver|estar\s+aqui)\b|\bnao\s+aguento\s+mais\s+viver\b/,
    /\bmelhor\s+(?:morto|morta|estar\s+morto|estar\s+morta)\b/,
    /\b(?:me\s+machucar|me\s+ferir|automutilacao|auto\s*mutilacao|me\s+cortar)\b/,
    /\bnao\s+vale\s+a\s+pena\s+viver\b/,
    /\b(?:tomei|tomar|vou\s+tomar|fiz|tive)\s+(?:uma\s+)?(?:overdose|sobredose)\b|\bsobredose\b/,
  ],
};
