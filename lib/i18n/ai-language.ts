/**
 * AI response-language handling (docs/dev/QUESTIONNAIRE_SPEC.md section 6.6). The prompt receives a language NAME
 * looked up from the server-side registry by an allowlisted BCP 47 tag, never raw user text.
 */
import { AI_LANGUAGE_TAGS, aiPromptLanguage, isAiExperimental, type LocaleTag } from "@/config/locales";

export { AI_LANGUAGE_TAGS, isAiExperimental };

export function isAiLanguage(tag: unknown): tag is string {
  return typeof tag === "string" && (AI_LANGUAGE_TAGS as readonly string[]).includes(tag);
}

/** Allowlist a tag: anything not in the registry becomes "en". */
export function safeAiLanguage(tag: unknown): string {
  return isAiLanguage(tag) ? tag : "en";
}

/** Prompt line value for the response language ("Spanish", "Chinese (Simplified)"...). Unknown tags give English. */
export function promptLanguageName(tag: unknown): string {
  return aiPromptLanguage(safeAiLanguage(tag));
}

/**
 * Wrap a per-language text table so any language without its own entry falls back to the English entry
 * (the client shows the localized crisis line and notices; server-written text stays correct English).
 */
export function withEnglishFallback<X>(table: { en: X } & Partial<Record<LocaleTag, X>>): Record<LocaleTag, X> {
  return new Proxy(table, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && !(prop in target)) return Reflect.get(target, "en", receiver);
      return Reflect.get(target, prop, receiver);
    },
  }) as Record<LocaleTag, X>;
}
