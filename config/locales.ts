/**
 * Locale registry (data only). Adding a language = one entry here + `npm run i18n:translate -- <tag>`
 * + (optional) a crisis lexicon + (optional) a font pack. No component code changes.
 * docs/dev/QUESTIONNAIRE_SPEC.md section 6.1.
 */
export type FontPackId = "noto-sc" | "noto-tc" | "noto-kr" | "noto-arabic" | "noto-deva" | "noto-beng" | "noto-gujr";
export type Script = "Latn" | "Hans" | "Hant" | "Arab" | "Hebr" | "Deva" | "Beng" | "Gujr" | "Hang" | "Cyrl" | "Viet";

/** Every locale tag (one place to add a language; a unit test checks it matches LOCALES). */
export const LOCALE_TAG_LIST = ["en", "es", "pt", "ht", "zh-Hans", "zh-Hant", "vi", "ko", "tl", "ar", "ru", "fr", "hi"] as const;
export type LocaleTag = (typeof LOCALE_TAG_LIST)[number];

export interface LocaleDef {
  /** BCP 47 tag (also the file name public/i18n/<tag>.json). */
  tag: LocaleTag;
  nativeName: string;
  englishName: string;
  dir: "ltr" | "rtl";
  script: Script;
  fontPack?: FontPackId;
  /** The AI (analyze / ask) may answer in this language. */
  aiSupported: boolean;
  /** True only after a native or professional review of its crisis lexicon (never for machine-made lexicons). */
  crisisLexicon: boolean;
  /** Review state of the UI strings when no manifest is available (en: reviewed; everything else: machine). */
  baseStatus: "reviewed" | "machine";
  /** AI output in this language is labelled experimental (replaces the old `language === "ht"` check). */
  aiExperimental: boolean;
  /** Locale used for Intl formatting. Defaults to the tag. */
  intl?: string;
}

const L = (d: Omit<LocaleDef, "aiSupported" | "crisisLexicon" | "baseStatus" | "aiExperimental"> & Partial<Pick<LocaleDef, "aiSupported" | "crisisLexicon" | "baseStatus" | "aiExperimental">>): LocaleDef => ({
  aiSupported: true,
  crisisLexicon: false,
  baseStatus: "machine",
  aiExperimental: true,
  ...d,
});

// Unfinished (pl partial; bn, gu, ur, fa empty) and cut for now: re-add the entries + run `npm run i18n:translate -- <tag>`.
export const LOCALES: readonly LocaleDef[] = [
  L({ tag: "en", nativeName: "English", englishName: "English", dir: "ltr", script: "Latn", baseStatus: "reviewed", aiExperimental: false, crisisLexicon: true, intl: "en-US" }),
  // Shipped earlier with human-style (not native-reviewed) strings; es/pt AI output is not labelled experimental.
  L({ tag: "es", nativeName: "Español", englishName: "Spanish", dir: "ltr", script: "Latn", aiExperimental: false, intl: "es-US" }),
  L({ tag: "pt", nativeName: "Português", englishName: "Portuguese", dir: "ltr", script: "Latn", aiExperimental: false, intl: "pt-BR" }),
  L({ tag: "ht", nativeName: "Kreyòl ayisyen", englishName: "Haitian Creole", dir: "ltr", script: "Latn" }),
  L({ tag: "zh-Hans", nativeName: "简体中文", englishName: "Chinese (Simplified)", dir: "ltr", script: "Hans", fontPack: "noto-sc" }),
  L({ tag: "zh-Hant", nativeName: "繁體中文", englishName: "Chinese (Traditional)", dir: "ltr", script: "Hant", fontPack: "noto-tc" }),
  L({ tag: "vi", nativeName: "Tiếng Việt", englishName: "Vietnamese", dir: "ltr", script: "Viet" }),
  L({ tag: "ko", nativeName: "한국어", englishName: "Korean", dir: "ltr", script: "Hang", fontPack: "noto-kr" }),
  L({ tag: "tl", nativeName: "Tagalog", englishName: "Tagalog (Filipino)", dir: "ltr", script: "Latn" }),
  L({ tag: "ar", nativeName: "العربية", englishName: "Arabic", dir: "rtl", script: "Arab", fontPack: "noto-arabic" }),
  L({ tag: "ru", nativeName: "Русский", englishName: "Russian", dir: "ltr", script: "Cyrl" }),
  L({ tag: "fr", nativeName: "Français", englishName: "French", dir: "ltr", script: "Latn" }),
  L({ tag: "hi", nativeName: "हिन्दी", englishName: "Hindi", dir: "ltr", script: "Deva", fontPack: "noto-deva" }),
];

export const DEFAULT_LOCALE = "en";

/** BCP 47 tags the AI may answer in. The prompt gets englishName from this registry, never raw user text. */
export const AI_LANGUAGE_TAGS = LOCALES.filter((l) => l.aiSupported).map((l) => l.tag) as unknown as readonly [LocaleTag, ...LocaleTag[]];

export function getLocale(tag: string): LocaleDef | undefined {
  return LOCALES.find((l) => l.tag === tag);
}

export function isLocaleTag(tag: unknown): tag is LocaleTag {
  return typeof tag === "string" && LOCALES.some((l) => l.tag === tag);
}

/** English name for an AI language tag (allowlist lookup; unknown tags fall back to English). */
export function aiLanguageName(tag: string): string {
  const l = LOCALES.find((x) => x.tag === tag && x.aiSupported);
  return l ? l.englishName.replace(/ \(.*\)$/, "") : "English";
}

/** Prompt-friendly language name (keeps the script variant for Chinese; Brazilian for Portuguese). */
export function aiPromptLanguage(tag: string): string {
  if (tag === "pt") return "Portuguese (Brazilian)";
  if (tag === "zh-Hans") return "Chinese (Simplified)";
  if (tag === "zh-Hant") return "Chinese (Traditional)";
  if (tag === "tl") return "Tagalog (Filipino)";
  if (tag === "fa") return "Persian (Farsi)";
  return aiLanguageName(tag);
}

export function isAiExperimental(tag: string): boolean {
  const l = getLocale(tag);
  return !l || l.aiExperimental;
}

export function intlLocale(tag: string): string {
  const l = getLocale(tag);
  return l?.intl ?? l?.tag ?? "en-US";
}
