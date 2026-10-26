/**
 * Pure helpers for the i18n platform: flat key paths, placeholder handling, per-key English fallback,
 * and plural selection. No React, no DOM, no dependencies (docs/dev/QUESTIONNAIRE_SPEC.md section 6.2).
 */

/** Dot-separated path to every string leaf of a nested `as const` messages object (arrays use indexes). */
export type Paths<T> = T extends string
  ? never
  : T extends readonly unknown[]
    ? { [I in keyof T & `${number}`]: T[I] extends string ? I : `${I}.${Paths<T[I]>}` }[keyof T & `${number}`]
    : T extends object
      ? { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string]
      : never;

export type FlatMessages = Record<string, string>;
export type Vars = Record<string, string | number>;

/** Flatten a nested messages object to `{ "a.b.0.c": "text" }`. */
export function flatten(obj: unknown, prefix = "", out: FlatMessages = {}): FlatMessages {
  if (typeof obj === "string") {
    out[prefix] = obj;
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/**
 * Rebuild a nested messages object with the shape of `shape` (the English source), taking each string
 * leaf from `flat` when present and non-empty, otherwise keeping the English leaf (per-key fallback).
 */
export function overlay<T>(shape: T, flat: FlatMessages, prefix = ""): T {
  if (typeof shape === "string") {
    const v = flat[prefix];
    return (typeof v === "string" && v.length > 0 ? v : shape) as T;
  }
  if (Array.isArray(shape)) return shape.map((v, i) => overlay(v, flat, prefix ? `${prefix}.${i}` : String(i))) as T;
  if (shape && typeof shape === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(shape)) out[k] = overlay(v, flat, prefix ? `${prefix}.${k}` : k);
    return out as T;
  }
  return shape;
}

/** Sorted, de-duplicated `{name}` placeholders in a string. */
export function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

/** Replace {name} placeholders. Unknown placeholders are left as-is. */
export function format(template: string, values: Vars): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** Fraction (0..1) of English keys that have a translation. */
export function coverage(enFlat: FlatMessages, flat: FlatMessages): number {
  const keys = Object.keys(enFlat);
  if (keys.length === 0) return 1;
  return keys.filter((k) => typeof flat[k] === "string" && flat[k]!.length > 0).length / keys.length;
}

/** Plural category for `n` in `tag` ("one", "other", "few", ...). Falls back to "other" for a bad tag. */
export function pluralCategory(tag: string, n: number): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(tag).select(n);
  } catch {
    return "other";
  }
}

/** Plural categories a locale needs (used by the translate script and parity tests). */
export function pluralCategories(tag: string): Intl.LDMLPluralRule[] {
  try {
    return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
  } catch {
    return ["one", "other"];
  }
}

/**
 * Look up `key` with per-key English fallback. Plural keys: when `vars.count` is a number and
 * `${key}.${category}` exists it wins (then `${key}.other`).
 */
export function lookup(flat: FlatMessages, enFlat: FlatMessages, tag: string, key: string, vars?: Vars): string {
  let template: string | undefined;
  if (vars && typeof vars.count === "number") {
    const cat = pluralCategory(tag, vars.count);
    template = flat[`${key}.${cat}`] ?? flat[`${key}.other`];
    if (template === undefined) {
      const enCat = pluralCategory("en", vars.count);
      template = enFlat[`${key}.${enCat}`] ?? enFlat[`${key}.other`];
    }
  }
  template ??= flat[key] || enFlat[key] || key;
  return vars ? format(template, vars) : template;
}

/** Small stable (non-cryptographic) hash of a string, used to detect stale translations. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
