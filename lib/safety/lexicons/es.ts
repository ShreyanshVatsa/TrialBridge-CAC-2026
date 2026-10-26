import type { CrisisLexicon } from "../types";

export const lexicon: CrisisLexicon = {
  tag: "es",
  reviewed: false,
  patterns: [
    /suicid/,
    /\bmatarme\b|\bme\s+(?:quiero|voy\s+a|puedo)\s+matar\b/,
    /\bquitarme\s+la\s+vida\b|quitar(?:me)?\s+mi\s+vida/,
    /\b(?:acabar|terminar|acabo|termino)\s+con\s+(?:mi\s+vida|todo)\b|terminar\s+mi\s+vida/,
    /\bquiero\s+(?:morir|morirme|desaparecer|acabar\s+con\s+(?:mi\s+vida|todo))/,
    /\bno\s+quiero\s+(?:vivir|seguir\s+viviendo|estar\s+aqui)\b|ya\s+no\s+quiero\s+estar\s+aqui/,
    /\bmejor\s+(?:muert[oa]|estar\s+muert[oa])\b/,
    /\bojala\s+(?:estuviera|estuviese)\s+muert[oa]\b/,
    /\b(?:hacerme\s+(?:dano|mal)|lastimarme|autolesion|cortarme)\b/,
    /\bno\s+vale\s+la\s+pena\s+(?:vivir|seguir\s+viviendo)\b/,
    /\bsobredosis\b/,
    /\bno\s+tiene\s+sentido\s+(?:vivir|seguir)\b/,
  ],
};
