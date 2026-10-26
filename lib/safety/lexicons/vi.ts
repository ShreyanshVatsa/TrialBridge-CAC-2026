import type { CrisisLexicon } from "../types";

/** Machine-made lexicon, NOT reviewed by a native speaker: used only as an extra, conservative signal. */
export const lexicon: CrisisLexicon = {
  tag: "vi",
  reviewed: false,
  patterns: [
    /\btu\s+tu\b|\btu\s+sat\b|\bquyen\s+sinh\b/,
    /\bmuon\s+chet\b/,
    /\bkhong\s+muon\s+song\b/,
    /\bket\s+thuc\s+(?:cuoc\s+doi|cuoc\s+song|mang\s+song)\b/,
    /\bgiet\s+(?:chinh\s+)?(?:ban\s+than|minh|toi)\b/,
    /\btu\s+(?:lam\s+hai|lam\s+dau|huy\s+hoai)\b/,
    /\bqua\s+lieu\b/,
    /\bsong\s+khong\s+con\s+y\s+nghia\b|\bkhong\s+con\s+ly\s+do\s+de\s+song\b/,
  ],
};
