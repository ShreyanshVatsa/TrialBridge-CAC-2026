"use client";

/**
 * i18n runtime (docs/dev/QUESTIONNAIRE_SPEC.md section 6.2). English is the typed source (./en) and is bundled.
 * Every other language is a flat JSON file fetched on demand from /i18n/<tag>.json (same-origin),
 * with per-key English fallback. `useMessages()` keeps returning the nested messages object (missing
 * keys filled from English); `useT()` is the flat `t(key, vars)` API with plural and Intl helpers.
 */
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, getLocale, intlLocale, isLocaleTag, type FontPackId, type LocaleDef, type LocaleTag } from "@/config/locales";
import { coverage as coverageOf, flatten, format, lookup, overlay, type FlatMessages, type Paths, type Vars } from "@/lib/i18n/keys";
import { isManifest, noteKind, type LocaleStatus, type Manifest, type ManifestEntry } from "@/lib/i18n/manifest";
import { en, type Messages } from "./en";

export type { Messages };
export { format };

/** Every message key as a dot path, e.g. `"questionnaire.ui.whyAsk"`. A missing English key is a compile error. */
export type MessageKey = Paths<typeof en>;
/** Base of a plural group (`x.one` / `x.other` ...): pass with `{ count }` to `t`. */
type PluralKey = MessageKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

/** UI languages = locale registry tags. A language is a BCP 47 tag string. */
export type Language = LocaleTag;
const STORAGE_KEY = "tb-lang";

export interface T {
  (key: MessageKey | PluralKey, vars?: Vars): string;
}

interface UseT {
  t: T;
  lang: LocaleTag;
  dir: "ltr" | "rtl";
  status: LocaleStatus;
  coverage: number;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  formatDate: (d: Date, opts?: Intl.DateTimeFormatOptions) => string;
}

interface State {
  /** Language whose messages are loaded and displayed. */
  lang: LocaleTag;
  messages: Messages;
  flat: FlatMessages;
  def: LocaleDef;
  entry: ManifestEntry | undefined;
  api: UseT;
  /** Set when the last attempt to load a language failed. */
  failed: string | null;
}

const EN_FLAT = flatten(en);
const EN_DEF = getLocale(DEFAULT_LOCALE)!;

function makeState(lang: LocaleTag, flat: FlatMessages, entry: ManifestEntry | undefined, messages: Messages, failed: string | null = null): State {
  const def = getLocale(lang) ?? EN_DEF;
  const intl = intlLocale(def.tag);
  const status: LocaleStatus = entry?.status ?? (def.baseStatus === "reviewed" ? "reviewed" : "machine");
  const cov = entry?.coverage ?? (lang === "en" ? 1 : coverageOf(EN_FLAT, flat));
  const api: UseT = {
    t: (key, vars) => lookup(flat, EN_FLAT, def.tag, key, vars),
    lang: def.tag,
    dir: def.dir,
    status,
    coverage: cov,
    formatNumber: (n, opts) => new Intl.NumberFormat(intl, opts).format(n),
    formatDate: (d, opts) => new Intl.DateTimeFormat(intl, opts ?? { year: "numeric", month: "short", day: "numeric" }).format(d),
  };
  return { lang: def.tag, messages, flat, def, entry, api, failed };
}

const EN_STATE: State = makeState("en", EN_FLAT, undefined, en as unknown as Messages);
let state: State | null = null;
const listeners = new Set<() => void>();

const fontLinks = new Set<FontPackId>();
/** Inject the font pack stylesheet (same-origin, CSP-safe) only when a language that needs it is chosen. */
function ensureFontPack(pack: FontPackId | undefined): void {
  if (!pack || fontLinks.has(pack) || typeof document === "undefined") return;
  fontLinks.add(pack);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `/fonts/noto/${pack}.css`;
  link.setAttribute("data-font-pack", pack);
  document.head.appendChild(link);
}

function emit(next: State) {
  state = next;
  const root = document.documentElement;
  root.lang = next.lang;
  root.dir = next.def.dir;
  root.removeAttribute("data-lang-pending");
  ensureFontPack(next.def.fontPack);
  listeners.forEach((l) => l());
}

let manifestPromise: Promise<Manifest | null> | null = null;
function loadManifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch("/i18n/manifest.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: unknown) => (isManifest(j) ? j : null))
    .catch(() => null);
  return manifestPromise;
}

const cache = new Map<LocaleTag, State>();
let loadToken = 0;

async function fetchLocale(tag: LocaleTag): Promise<State> {
  const hit = cache.get(tag);
  if (hit) return hit;
  const [res, manifest] = await Promise.all([fetch(`/i18n/${tag}.json`), loadManifest()]);
  if (!res.ok) throw new Error(`locale ${tag}: HTTP ${res.status}`);
  const flat = (await res.json()) as FlatMessages;
  const next = makeState(tag, flat, manifest?.locales[tag], overlay(en as unknown as Messages, flat));
  cache.set(tag, next);
  return next;
}

function load(lang: LocaleTag) {
  const token = ++loadToken;
  if (lang === DEFAULT_LOCALE) {
    emit(EN_STATE);
    return;
  }
  const def = getLocale(lang);
  if (def) ensureFontPack(def.fontPack); // start the font request alongside the strings
  fetchLocale(lang)
    .then((next) => {
      if (token === loadToken) emit(next);
    })
    .catch(() => {
      // Offline or file missing: stay in the current language, reveal the page, flag the failure.
      document.documentElement.removeAttribute("data-lang-pending");
      if (token === loadToken) {
        const cur = state ?? EN_STATE;
        state = { ...cur, failed: lang };
        listeners.forEach((l) => l());
      }
    });
}

function read(): State {
  if (state) return state;
  state = EN_STATE;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved !== DEFAULT_LOCALE && isLocaleTag(saved)) load(saved);
    else if (saved && saved !== DEFAULT_LOCALE) emit(EN_STATE); // stale/unknown tag: theme-init hid the page for it
  } catch {
    // Storage blocked: English.
  }
  return state;
}

/** Choose the UI language. A display preference only: saved in localStorage, never sent anywhere. */
export function setLanguage(lang: string): void {
  if (!isLocaleTag(lang)) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Not persisted; still applies to this page view.
  }
  load(lang);
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function useI18nState(): State {
  return useSyncExternalStore(subscribe, read, () => EN_STATE);
}

export function useLanguage(): LocaleTag {
  return useI18nState().lang;
}

/** Active UI messages (nested), with missing keys filled from English. */
export function useMessages(): Messages {
  return useI18nState().messages;
}

/** Flat `t(key, vars)` API plus lang/dir/status and Intl number/date helpers. */
export function useT(): UseT {
  return useI18nState().api;
}

/** What to tell the reader about the active translation, and whether the last switch failed. */
export function useTranslationNote(): { kind: "none" | "partial" | "machine"; coverage: number; failedLang: string | null } {
  const s = useI18nState();
  return { kind: noteKind(s.entry ?? { status: s.api.status, coverage: s.api.coverage }, s.lang), coverage: s.api.coverage, failedLang: s.failed };
}

/** BCP 47 locale for Intl formatting. */
export function localeFor(lang: string): string {
  return intlLocale(lang);
}

/** Reveals the page once the saved language has rendered (theme-init.js hides it to avoid an English flash). */
export function LanguageReady(): null {
  const lang = useLanguage();
  useEffect(() => {
    const root = document.documentElement;
    const pending = root.getAttribute("data-lang-pending");
    if (!pending || pending === lang) root.removeAttribute("data-lang-pending");
  }, [lang]);
  return null;
}
