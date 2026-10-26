import { describe, expect, it } from "vitest";
import { coverage, flatten, format, hashText, lookup, overlay, placeholders, pluralCategories, pluralCategory } from "@/lib/i18n/keys";
import { filterLocales, fold, suggestLocale } from "@/lib/i18n/search";
import { LOCALES } from "@/config/locales";

const en = { a: { b: "Hello {name}", list: ["one", "two {n}"] }, n: { one: "{count} item", other: "{count} items" }, only: "English only" };

describe("flatten / overlay", () => {
  it("flattens nested objects and arrays to dot paths", () => {
    expect(flatten(en)).toEqual({ "a.b": "Hello {name}", "a.list.0": "one", "a.list.1": "two {n}", "n.one": "{count} item", "n.other": "{count} items", only: "English only" });
  });
  it("ignores non-string leaves", () => {
    expect(flatten({ x: 1, y: null, z: "ok" })).toEqual({ z: "ok" });
  });
  it("overlays translations with per-key English fallback", () => {
    const out = overlay(en, { "a.b": "Hola {name}", "a.list.1": "dos {n}", only: "" });
    expect(out.a.b).toBe("Hola {name}");
    expect(out.a.list).toEqual(["one", "dos {n}"]);
    expect(out.only).toBe("English only"); // empty translation falls back
    expect(out.n.other).toBe("{count} items");
  });
  it("keeps non-string primitives", () => {
    expect(overlay({ n: 3 as unknown as string }, {})).toEqual({ n: 3 });
  });
});

describe("placeholders / format", () => {
  it("lists distinct sorted placeholders", () => {
    expect(placeholders("{b} and {a} and {b}")).toEqual(["a", "b"]);
    expect(placeholders("none")).toEqual([]);
  });
  it("fills known values and leaves unknown ones", () => {
    expect(format("{a}-{b}", { a: 1 })).toBe("1-{b}");
  });
});

describe("lookup with plurals and fallback", () => {
  const enFlat = flatten(en);
  const ru = { "n.one": "{count} штука", "n.few": "{count} штуки", "n.many": "{count} штук", "n.other": "{count} штуки", "a.b": "Привет {name}" };
  it("selects the plural category of the locale", () => {
    expect(lookup(ru, enFlat, "ru", "n", { count: 1 })).toBe("1 штука");
    expect(lookup(ru, enFlat, "ru", "n", { count: 3 })).toBe("3 штуки");
    expect(lookup(ru, enFlat, "ru", "n", { count: 5 })).toBe("5 штук");
  });
  it("falls back to English plural forms and plain English keys", () => {
    expect(lookup({}, enFlat, "ru", "n", { count: 1 })).toBe("1 item");
    expect(lookup({}, enFlat, "ru", "n", { count: 2 })).toBe("2 items");
    expect(lookup({}, enFlat, "ru", "only")).toBe("English only");
  });
  it("returns the key itself when nothing matches and formats variables", () => {
    expect(lookup({}, enFlat, "ru", "missing.key")).toBe("missing.key");
    expect(lookup(ru, enFlat, "ru", "a.b", { name: "Анна" })).toBe("Привет Анна");
  });
  it("tolerates a broken language tag", () => {
    expect(pluralCategory("not a tag!!", 1)).toBe("other");
    expect(pluralCategories("not a tag!!")).toEqual(["one", "other"]);
  });
  it("knows required plural categories", () => {
    expect(pluralCategories("ar")).toEqual(expect.arrayContaining(["zero", "one", "two", "few", "many", "other"]));
    expect(pluralCategories("zh-Hans")).toEqual(["other"]);
  });
});

describe("coverage / hash", () => {
  it("computes the translated fraction", () => {
    expect(coverage({ a: "x", b: "y" }, { a: "z" })).toBe(0.5);
    expect(coverage({}, {})).toBe(1);
    expect(coverage({ a: "x" }, { a: "" })).toBe(0);
  });
  it("hashes deterministically and differently for different text", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});

describe("language search", () => {
  it("folds accents and case", () => {
    expect(fold("  Español ")).toBe("espanol");
  });
  it("matches native name, English name and tag; empty query lists all", () => {
    expect(filterLocales(LOCALES, "").length).toBe(LOCALES.length);
    expect(filterLocales(LOCALES, "espanol").map((l) => l.tag)).toEqual(["es"]);
    expect(filterLocales(LOCALES, "Vietnamese").map((l) => l.tag)).toEqual(["vi"]);
    expect(filterLocales(LOCALES, "tiếng việt").map((l) => l.tag)).toEqual(["vi"]);
    expect(filterLocales(LOCALES, "zh-h").map((l) => l.tag)).toEqual(["zh-Hans", "zh-Hant"]);
    expect(filterLocales(LOCALES, "العربية").map((l) => l.tag)).toEqual(["ar"]);
    expect(filterLocales(LOCALES, "zzzz")).toEqual([]);
  });
  it("suggests a supported non-English browser language, never English", () => {
    expect(suggestLocale(["es-MX", "en"], LOCALES)?.tag).toBe("es");
    expect(suggestLocale(["zh-TW"], LOCALES)?.tag).toBe("zh-Hant");
    expect(suggestLocale(["zh-CN"], LOCALES)?.tag).toBe("zh-Hans");
    expect(suggestLocale(["zh-Hant-HK"], LOCALES)?.tag).toBe("zh-Hant");
    expect(suggestLocale(["fil"], LOCALES)?.tag).toBe("tl");
    expect(suggestLocale(["pt-BR"], LOCALES)?.tag).toBe("pt");
    expect(suggestLocale(["en-US", "es"], LOCALES)).toBeNull();
    expect(suggestLocale(["xx", "fr"], LOCALES)?.tag).toBe("fr");
    expect(suggestLocale(["xx"], LOCALES)).toBeNull();
    expect(suggestLocale([], LOCALES)).toBeNull();
  });
});
