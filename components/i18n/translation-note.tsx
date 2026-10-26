"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { getLocale, LOCALES } from "@/config/locales";
import { suggestLocale } from "@/lib/i18n/search";
import { setLanguage, useLanguage, useT, useTranslationNote } from "./index";

const NOTE_KEY = "tb-lang-note-dismissed";
const SUGGEST_KEY = "tb-lang-suggest-dismissed";

function safeGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k) ?? localStorage.getItem(k);
  } catch {
    return null;
  }
}

/**
 * One small dismissible chip under the header (the dismissal is remembered per language) when the active language is partly translated or machine
 * translated ("Partially translated. Some text is in English." / "Machine-translated, not reviewed").
 * Also reports a failed language load. Replaces the old fixed footer note.
 */
export function TranslationNote() {
  const { t } = useT();
  const { kind, failedLang } = useTranslationNote();
  const lang = useLanguage();
  // Lazy read: this renders nothing during SSR/first paint (English), so there is no hydration mismatch.
  const [dismissed, setDismissed] = useState<string | null>(() => safeGet(NOTE_KEY));
  if (failedLang) {
    return (
      <div role="alert" className="no-print border-b border-border bg-muted px-4 py-2 text-center text-sm">
        {t("i18n.loadFailed")}
      </div>
    );
  }
  if (kind === "none" || dismissed === lang) return null;
  const parts = [kind === "partial" ? t("i18n.notePartial") : null, t("i18n.noteMachine")].filter(Boolean);
  return (
    <div role="status" data-testid="translation-note" className="no-print mx-auto mt-2 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 ps-3.5 pe-0.5 text-xs leading-snug">
      <p className="min-w-0">{parts.join(" ")}</p>
      <button
        type="button"
        aria-label={t("i18n.dismiss")}
        onClick={() => {
          try {
            localStorage.setItem(NOTE_KEY, lang);
          } catch {
            /* not persisted */
          }
          setDismissed(lang);
        }}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-background"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Hint only: when the browser prefers a supported non-English language and the person has not chosen
 * one, offer a one-click switch. Never switches by itself; nothing is sent anywhere.
 */
export function LanguageSuggest() {
  const { t } = useT();
  const lang = useLanguage();
  const [suggestion, setSuggestion] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem("tb-lang") || localStorage.getItem(SUGGEST_KEY)) return;
    } catch {
      return;
    }
    const s = suggestLocale(navigator.languages ?? [navigator.language], LOCALES);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only hint; must not run during SSR/hydration
    setSuggestion(s ? s.tag : null);
  }, []);
  const def = suggestion ? getLocale(suggestion) : undefined;
  if (!def || def.tag === lang) return null;
  const hide = () => {
    try {
      localStorage.setItem(SUGGEST_KEY, "1");
    } catch {
      /* not persisted */
    }
    setSuggestion(null);
  };
  return (
    <div role="region" aria-label={t("i18n.pickerLabel")} className="no-print mx-3 mt-3 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-border bg-accent/40 px-4 py-2 text-sm sm:mx-6">
      <span lang="en">{t("i18n.suggest")}</span>
      <button
        type="button"
        lang={def.tag}
        dir={def.dir}
        onClick={() => {
          setLanguage(def.tag);
          hide();
        }}
        className="tb-btn-glass min-h-9 rounded-full border border-border bg-background px-4 font-medium transition-colors hover:bg-muted"
      >
        {def.nativeName}
      </button>
      <button type="button" onClick={hide} className="min-h-9 rounded-full px-3 underline underline-offset-4">
        {t("i18n.dismiss")}
      </button>
    </div>
  );
}
