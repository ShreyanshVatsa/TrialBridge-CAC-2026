import { describe, expect, it, vi } from "vitest";
import {
  buildSystemPrompt,
  callModel,
  chunk,
  jsonSchemaFor,
  lengthBounds,
  missingPluralForms,
  parseJsonObject,
  translateKeys,
  validateTranslation,
  type TranslateOptions,
} from "@/lib/i18n/translate-core";

const opts: TranslateOptions = { tag: "es", languageName: "Spanish", glossary: { banned: ["usted es elegible"], terms: { "care team": "equipo médico" }, style: "Formal." } };

describe("validateTranslation", () => {
  const en = "Your matches for {count} trials near {zip}";
  it("accepts a good translation", () => {
    expect(validateTranslation("k", en, "Sus resultados para {count} estudios cerca de {zip}", opts)).toBeNull();
  });
  it("rejects non-strings and empty strings", () => {
    expect(validateTranslation("k", en, 5, opts)).toBe("not_string");
    expect(validateTranslation("k", en, "   ", opts)).toBe("empty");
  });
  it("rejects broken, missing or renamed placeholders", () => {
    expect(validateTranslation("k", en, "Sus resultados para {cuenta} estudios cerca de {zip}", opts)).toBe("placeholders");
    expect(validateTranslation("k", en, "Sus resultados para estudios cerca de {zip}", opts)).toBe("placeholders");
    expect(validateTranslation("k", en, "Sus resultados para {count} {count} estudios cerca de {zip} {extra}", opts)).toBe("placeholders");
  });
  it("rejects HTML and markdown that the source does not have", () => {
    expect(validateTranslation("k", "Open the page now", "<b>Abra</b> la página ahora", opts)).toBe("html");
    expect(validateTranslation("k", "Open the page now", "**Abra** la página ahora", opts)).toBe("html");
    expect(validateTranslation("k", "Open the page now", "[Abra](http://x.test) la página", opts)).toBe("html");
    expect(validateTranslation("k", "Use <b>bold</b> here ok", "Use <b>negrita</b> aquí ok", opts)).toBeNull();
  });
  it("rejects length outliers (Latin and CJK bounds) but not very short strings", () => {
    expect(validateTranslation("k", "A reasonably long sentence about trials", "Ok", opts)).toBe("length");
    expect(validateTranslation("k", "Some short text", "x".repeat(200), opts)).toBe("length");
    expect(validateTranslation("k", "Back", "x".repeat(30), opts)).toBeNull();
    expect(lengthBounds("zh-Hans")).toEqual([0.1, 1.8]);
    expect(lengthBounds("es")).toEqual([0.3, 2.5]);
    expect(validateTranslation("k", "A reasonably long sentence about trials", "关于临床试验的一个相当长的句子说明", { ...opts, tag: "zh-Hans" })).toBeNull();
  });
  it("rejects text identical to English unless short or allow-listed", () => {
    expect(validateTranslation("k", "Find a clinical trial today", "Find a clinical trial today", opts)).toBe("identical");
    expect(validateTranslation("k", "Find a clinical trial today", "Find a clinical trial today", { ...opts, allowIdentical: ["Find a clinical trial today"] })).toBeNull();
    expect(validateTranslation("k", "Menu", "Menu", opts)).toBeNull();
    expect(validateTranslation("k", "TrialBridge", "TrialBridge", opts)).toBeNull();
    expect(validateTranslation("k", "© {year} TrialBridge", "© {year} TrialBridge", opts)).toBeNull();
  });
  it("requires phone numbers and other 3+ digit numbers to survive", () => {
    expect(validateTranslation("k", "Call 988 now for help", "Llame ahora para ayuda", opts)).toBe("numbers");
    expect(validateTranslation("k", "Call 988 now for help", "Llame al 988 ahora para ayuda", opts)).toBeNull();
  });
  it("rejects banned claims, accent-insensitively", () => {
    expect(validateTranslation("k", "This might be a good fit for you", "Usted es elegible para esto", opts)).toBe("banned");
    expect(validateTranslation("k", "This might be a good fit for you", "USTED ES ELEGIBLE para esto", opts)).toBe("banned");
  });
});

describe("helpers", () => {
  it("chunks arrays", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("builds a prompt with the glossary, banned list and style", () => {
    const p = buildSystemPrompt(opts);
    expect(p).toContain("Spanish");
    expect(p).toContain("care team => equipo médico");
    expect(p).toContain("usted es elegible");
    expect(p).toContain("Formal.");
    expect(buildSystemPrompt({ tag: "fr", languageName: "French" })).not.toContain("GLOSSARY");
  });
  it("builds a JSON schema that requires every key", () => {
    const s = jsonSchemaFor(["a", "b"]);
    expect(s.required).toEqual(["a", "b"]);
    expect(Object.keys(s.properties)).toEqual(["a", "b"]);
  });
  it("parses JSON objects out of noisy model output", () => {
    expect(parseJsonObject('<think>x</think> {"a":"b"} trailing')).toEqual({ a: "b" });
    expect(parseJsonObject("no json")).toBeNull();
    expect(parseJsonObject("{broken")).toBeNull();
    expect(parseJsonObject("[1,2]")).toBeNull();
    expect(parseJsonObject('{"a": ')).toBeNull();
  });
  it("finds missing plural forms for a locale", () => {
    const en = { "x.one": "a", "x.other": "b", "lbl.other": "Other", plain: "p" };
    expect(missingPluralForms("ru", { "x.one": "a", "x.other": "b" }, en).sort()).toEqual(["x.few", "x.many"]);
    expect(missingPluralForms("zh-Hans", { "x.other": "b" }, en)).toEqual([]);
    expect(missingPluralForms("en", { plain: "x", "lbl.other": "O" }, en)).toEqual([]);
    expect(missingPluralForms("ru", {}, en)).toEqual([]); // group not started yet
  });
});

function mockFetch(handler: (body: { messages: { content: string }[] }) => unknown): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const out = handler(JSON.parse(init.body as string));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }] }) } as Response;
  }) as unknown as typeof fetch;
}

describe("callModel and translateKeys (mocked endpoint)", () => {
  const cfg = (fetchImpl: typeof fetch) => ({ baseUrl: "http://x.test/v1/", model: "m", fetchImpl, apiKey: "k", temperature: 0.1 });

  it("sends an OpenAI-compatible request with schema output, thinking off, and the API key", async () => {
    const f = vi.fn(mockFetch(() => ({ a: "uno" })));
    const out = await callModel(cfg(f as unknown as typeof fetch), "sys", { a: "one" });
    expect(out).toEqual({ a: "uno" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://x.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.1);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
  });

  it("throws on HTTP errors and returns null for empty content", async () => {
    const bad = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    await expect(callModel(cfg(bad), "s", { a: "x" })).rejects.toThrow("HTTP 500");
    const empty = (async () => ({ ok: true, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await callModel(cfg(empty), "s", { a: "x" })).toBeNull();
  });

  it("accepts valid keys, rejects broken ones, retries once, and leaves the rest missing", async () => {
    let calls = 0;
    const f = mockFetch((body) => {
      calls++;
      const asked = JSON.parse(body.messages[1]!.content.split("\n").slice(1).join("\n").replace("\n/no_think", "")) as Record<string, string>;
      return Object.fromEntries(
        Object.keys(asked).map((k) => [k, k === "bad" ? "sin {marcador}" : k === "flaky" && calls === 1 ? "<b>x</b> nada" : `ES(${asked[k]})`]),
      );
    });
    const progress: number[] = [];
    const res = await translateKeys(
      { good: "Hello there friend", bad: "Hello {name}", flaky: "Welcome back to the page" },
      cfg(f),
      { ...opts, tag: "es", allowIdentical: [] },
      (d) => progress.push(d),
    );
    expect(res.accepted.good).toBe("ES(Hello there friend)");
    expect(res.accepted.flaky).toBe("ES(Welcome back to the page)"); // fixed by the retry
    expect(res.accepted.bad).toBeUndefined();
    expect(res.rejected.bad).toBe("placeholders");
    expect(progress.length).toBeGreaterThan(0);
  });

  it("treats a failing endpoint as missing keys and honours concurrency", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const res = await translateKeys({ a: "Hello there", b: "Another one here" }, { ...cfg(failing), concurrency: 3 }, opts);
    expect(res.accepted).toEqual({});
    expect(res.rejected).toEqual({ a: "missing", b: "missing" });
  });

  it("translates more than one batch", async () => {
    const todo = Object.fromEntries(Array.from({ length: 95 }, (_, i) => [`k${i}`, `Sentence number ${i} here`]));
    const f = mockFetch((body) => {
      const asked = JSON.parse(body.messages[1]!.content.split("\n").slice(1).join("\n").replace("\n/no_think", "")) as Record<string, string>;
      return Object.fromEntries(Object.entries(asked).map(([k, v]) => [k, `ES ${v}`]));
    });
    const res = await translateKeys(todo, { ...cfg(f), concurrency: 2 }, opts);
    expect(Object.keys(res.accepted)).toHaveLength(95);
  });
});
