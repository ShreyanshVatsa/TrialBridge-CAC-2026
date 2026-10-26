/**
 * Text normalization for crisis matching: accent-insensitive, case-insensitive, script-aware folding.
 * Lexicon patterns are normalized with the same function when compiled, so a phrase written with or
 * without diacritics ("suicídio" / "suicidio", Arabic with or without vowel marks) matches the same text.
 */
const EXTRA_FOLDS: Record<string, string> = {
  đ: "d", ł: "l", ø: "o", ı: "i", ß: "ss", æ: "ae", œ: "oe",
  // Arabic-script folding shared by Arabic, Persian and Urdu spellings.
  أ: "ا", إ: "ا", آ: "ا", ٱ: "ا", ة: "ه", ى: "ي", ی: "ي", ې: "ي", ے: "ي", ک: "ك", ڪ: "ك", ہ: "ه", ھ: "ه", ە: "ه", ں: "ن", ؤ: "و", ئ: "ي",
};
const FOLD_RE = new RegExp(`[${Object.keys(EXTRA_FOLDS).join("")}]`, "g");

export function normalizeForCrisis(text: string): string {
  return text
    .normalize("NFD")
    // Latin/Cyrillic combining marks, Arabic harakat + tatweel, Hebrew points, Indic nukta.
    .replace(/[̀-ًͯ-ٰٟـְ-़়ׇ]/g, "")
    .toLowerCase()
    .replace(FOLD_RE, (c) => EXTRA_FOLDS[c] ?? c)
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[‌‍‎‏]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compile a lexicon pattern: normalize its source like input text (write escapes in lowercase, e.g. \s \b). */
export function compilePattern(re: RegExp): RegExp {
  return new RegExp(normalizeForCrisis(re.source), re.flags.replace(/[gy]/g, ""));
}
