import type { LocaleDef } from "@/config/locales";

/** Lowercase, accent-insensitive form used to match what a person types against language names. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filter locales by native name, English name or tag (accent-insensitive). Empty query returns all. */
export function filterLocales(locales: readonly LocaleDef[], query: string): LocaleDef[] {
  const q = fold(query);
  if (!q) return [...locales];
  return locales.filter((l) => fold(l.nativeName).includes(q) || fold(l.englishName).includes(q) || l.tag.toLowerCase().startsWith(q));
}

/** First locale suggested by the browser's language list that is supported and not English (hint only). */
export function suggestLocale(browserLangs: readonly string[], locales: readonly LocaleDef[]): LocaleDef | null {
  for (const raw of browserLangs) {
    const lower = raw.toLowerCase();
    const base = lower.split("-")[0]!;
    if (base === "en") return null;
    let match: LocaleDef | undefined;
    if (base === "zh") match = locales.find((l) => l.tag === (/hant|tw|hk|mo/.test(lower) ? "zh-Hant" : "zh-Hans"));
    else if (base === "fil") match = locales.find((l) => l.tag === "tl");
    else match = locales.find((l) => l.tag.toLowerCase() === lower) ?? locales.find((l) => l.tag.toLowerCase() === base);
    if (match) return match;
  }
  return null;
}
