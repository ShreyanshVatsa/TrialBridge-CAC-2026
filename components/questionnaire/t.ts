"use client";

import { useMemo } from "react";
import { format, localeFor, useLanguage, useMessages } from "@/components/i18n";
import { en } from "@/components/i18n/en";
import type { MessageKey } from "./contract";

function resolve(root: unknown, key: string): string | undefined {
  let cur: unknown = root;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export type KeyT = ((key: MessageKey, vars?: Record<string, string | number>) => string) & { has: (key: MessageKey) => boolean; locale: string };

/**
 * Key-based lookup for catalog-driven text (labelKey, helpKey, whyKey...) with per-key English fallback.
 * Plurals: when vars.count is a number, `${key}.${Intl.PluralRules category}` (then `.other`) is used.
 */
export function useKeyT(): KeyT {
  const m = useMessages();
  const locale = localeFor(useLanguage());
  return useMemo(
    () =>
    Object.assign(
      (key: MessageKey, vars?: Record<string, string | number>) => {
        let raw: string | undefined;
        if (vars && typeof vars.count === "number") {
          const cat = new Intl.PluralRules(locale).select(vars.count);
          raw = resolve(m, `${key}.${cat}`) ?? resolve(m, `${key}.other`) ?? resolve(en, `${key}.${new Intl.PluralRules("en").select(vars.count)}`) ?? resolve(en, `${key}.other`);
          if (raw !== undefined) vars = { ...vars, count: new Intl.NumberFormat(locale).format(vars.count) };
        }
        raw ??= resolve(m, key) ?? resolve(en, key) ?? key;
        return vars ? format(raw, vars) : raw;
      },
      { has: (key: MessageKey) => Boolean(key) && (resolve(m, key) ?? resolve(en, key)) !== undefined, locale },
    ),
    [m, locale],
  );
}

/** Caregiver wording: a sibling key `<key>For` (third person) when one exists, else the normal key. */
export function variantKey(t: KeyT, key: MessageKey, caregiver: boolean): MessageKey {
  return caregiver && t.has(`${key}For`) ? `${key}For` : key;
}
