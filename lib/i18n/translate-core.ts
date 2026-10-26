/**
 * Pure core of `npm run i18n:translate` (docs/dev/QUESTIONNAIRE_SPEC.md section 6.8): prompt building, batching,
 * the OpenAI-compatible call (fetch injected for tests), and per-key validation. Keys that fail
 * validation twice are left missing, so they fall back to English at runtime.
 */
import { pluralCategories, placeholders, type FlatMessages } from "./keys";

export interface Glossary {
  /** English term -> preferred translation. */
  terms?: Record<string, string>;
  /** Claim phrases (accent-insensitive substrings) that must never appear: "you are eligible" equivalents. */
  banned?: string[];
  /** Extra style note for the model (register, script). */
  style?: string;
}

export interface TranslateOptions {
  tag: string;
  languageName: string;
  glossary?: Glossary;
  /** Strings allowed to stay identical to English. */
  allowIdentical?: readonly string[];
}

export const BATCH_SIZE = 40;
const DO_NOT_TRANSLATE = ["TrialBridge", "ClinicalTrials.gov", "988", "911", "ZIP", "NCT", "HIPAA", "U.S."] as const;

const CJK = new Set(["zh-Hans", "zh-Hant", "ko", "ja"]);

export function lengthBounds(tag: string): [number, number] {
  return CJK.has(tag) ? [0.1, 1.8] : [0.3, 2.5];
}

function strip(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type Rejection = "numbers" | "not_string" | "empty" | "placeholders" | "html" | "length" | "identical" | "banned" | "plural_forms";

/** Validate one translation. Returns null when acceptable, else the reason. */
export function validateTranslation(key: string, en: string, out: unknown, opts: TranslateOptions): Rejection | null {
  if (typeof out !== "string") return "not_string";
  const text = out.trim();
  if (text.length === 0) return "empty";
  const a = placeholders(en);
  const b = placeholders(text);
  if (a.length !== b.length || a.some((p, i) => p !== b[i])) return "placeholders";
  // Phone numbers and other 3+ digit numbers (988, 911, years) must survive exactly.
  const nums = en.replace(/\{\w+\}/g, "").match(/\d{3,}/g) ?? [];
  if (nums.some((n) => !text.includes(n))) return "numbers";
  // Markup: reject HTML tags, markdown emphasis, code ticks, and links the English source does not have.
  const markup = /<\/?[a-z][^>]*>|\*\*|`|\[[^\]]+\]\([^)]*\)/i;
  if (markup.test(text) && !markup.test(en)) return "html";
  if (en.length >= 12) {
    const [lo, hi] = lengthBounds(opts.tag);
    const r = text.length / en.length;
    if (r < lo || r > hi) return "length";
  }
  const words = en.replace(/\{\w+\}/g, "").trim().split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  const allowed = new Set([...(opts.allowIdentical ?? []), ...DO_NOT_TRANSLATE]);
  if (text === en && words.length > 2 && !allowed.has(en) && !/^[^A-Za-z]*$/.test(en)) return "identical";
  const banned = opts.glossary?.banned ?? [];
  const norm = strip(text);
  if (banned.some((p) => norm.includes(strip(p)))) return "banned";
  void key;
  return null;
}

const CATS = ["zero", "one", "two", "few", "many", "other"];

/** Base paths of English plural groups: keys that have both `.one` and `.other` (a lone `.other` is just a label). */
function pluralBases(enFlat: FlatMessages): string[] {
  return Object.keys(enFlat).filter((k) => k.endsWith(".other") && `${k.slice(0, -6)}.one` in enFlat).map((k) => k.slice(0, -6));
}

/** Plural-form keys a locale lacks, for the English plural groups it has started translating (`.other` present). */
export function missingPluralForms(tag: string, flat: FlatMessages, enFlat: FlatMessages): string[] {
  const missing: string[] = [];
  for (const base of pluralBases(enFlat)) {
    if (!(`${base}.other` in flat)) continue;
    for (const cat of pluralCategories(tag)) if (!(`${base}.${cat}` in flat)) missing.push(`${base}.${cat}`);
  }
  return missing;
}

/**
 * The keys a locale needs, with their English source text. English plural groups (`x.one` / `x.other`)
 * are expanded to the locale's own CLDR categories (e.g. ru: one/few/many/other, ar: zero..other; zh: other only);
 * the extra categories use the English `.other` text as their source.
 */
export function targetKeys(tag: string, enFlat: FlatMessages): FlatMessages {
  const cats = pluralCategories(tag);
  const bases = new Set(pluralBases(enFlat));
  const out: FlatMessages = {};
  const isPluralKey = (k: string) => {
    const i = k.lastIndexOf(".");
    return i > 0 && bases.has(k.slice(0, i)) && CATS.includes(k.slice(i + 1));
  };
  for (const [k, v] of Object.entries(enFlat)) if (!isPluralKey(k)) out[k] = v;
  for (const base of bases) for (const cat of cats) out[`${base}.${cat}`] = enFlat[`${base}.${cat}`] ?? enFlat[`${base}.other`]!;
  return out;
}

/** True when `key` is a plural-form key of a group present in `enFlat` (so it is not an orphan). */
export function isPluralFormKey(key: string, enFlat: FlatMessages): boolean {
  const i = key.lastIndexOf(".");
  return i > 0 && pluralBases(enFlat).includes(key.slice(0, i)) && CATS.includes(key.slice(i + 1));
}

/** Example numbers per plural category of a locale, for the prompt ("few: 2, 3, 4, 22"). */
export function pluralExamples(tag: string): string {
  const seen = new Map<string, number[]>();
  const rules = new Intl.PluralRules(tag);
  for (let n = 0; n <= 120; n++) {
    const c = rules.select(n);
    const arr = seen.get(c) ?? [];
    if (arr.length < 4) arr.push(n);
    seen.set(c, arr);
  }
  return [...seen].map(([c, ns]) => `${c}: ${ns.join(", ")}`).join("; ");
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function safePluralExamples(tag: string): string {
  try {
    return pluralExamples(tag);
  } catch {
    return "other";
  }
}

export function buildSystemPrompt(opts: TranslateOptions): string {
  const g = opts.glossary;
  const terms = g?.terms && Object.keys(g.terms).length ? "\nGLOSSARY (use these translations):\n" + Object.entries(g.terms).map(([k, v]) => `- ${k} => ${v}`).join("\n") : "";
  const banned = g?.banned?.length ? `\nNEVER write phrases meaning: ${g.banned.map((x) => `"${x}"`).join(", ")}. The app never tells a person they are eligible or qualify.` : "";
  return `You are a professional medical-UI translator. Translate short user-interface strings of a cancer clinical-trial finder from English into ${opts.languageName} (BCP 47: ${opts.tag}).
RULES
- Output a JSON object mapping each given key to its translation. Include every key.
- Keep {placeholders} like {count} or {date} exactly as written (same names, not translated, not removed).
- Do not translate: ${DO_NOT_TRANSLATE.join(", ")}. Keep numbers and URLs.
- Plain language, about 6th-grade reading level, warm and respectful, formal "you" where the language has one.
- Say "clinical trial" / "study" for trials. Never say a person is eligible or qualifies; use "possible match to discuss with your care team".
- Keys ending in .zero/.one/.two/.few/.many/.other are plural forms for that CLDR plural category of the target language (${opts.tag}: ${safePluralExamples(opts.tag)}). Write the form that is grammatically correct for numbers in that category; keep {count}.
- No HTML, no markdown, no emojis, no explanations. Translate meaning, not word for word. Keep roughly the same length.${g?.style ? `\n- ${g.style}` : ""}${terms}${banned}`;
}

function buildUserPrompt(batch: Record<string, string>): string {
  return `Translate these strings. The key path is context only (do not translate it).\n${JSON.stringify(batch, null, 1)}`;
}

export function jsonSchemaFor(keys: readonly string[]) {
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
    required: [...keys],
    additionalProperties: false,
  };
}

export interface LlmConfig {
  baseUrl: string; // e.g. http://127.0.0.1:8080/v1
  model: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  temperature?: number;
  /** Batches in flight at once (llama-server needs `-np` >= this to benefit). */
  concurrency?: number;
}

/** One chat-completion call returning the parsed JSON object (or null if it cannot be parsed). */
export async function callModel(cfg: LlmConfig, system: string, batch: Record<string, string>): Promise<Record<string, unknown> | null> {
  const f = cfg.fetchImpl ?? fetch;
  const keys = Object.keys(batch);
  const res = await f(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({
      model: cfg.model,
      temperature: cfg.temperature ?? 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${buildUserPrompt(batch)}\n/no_think` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "translations", strict: true, schema: jsonSchemaFor(keys) } },
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseJsonObject(body.choices?.[0]?.message?.content ?? "");
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface TranslateResult {
  accepted: FlatMessages;
  rejected: Record<string, Rejection | "missing">;
}

/**
 * Translate `todo` (key -> English) in batches. Failed keys are retried once, individually in a smaller
 * batch, and are otherwise left out (English fallback).
 */
export async function translateKeys(
  todo: FlatMessages,
  cfg: LlmConfig,
  opts: TranslateOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<TranslateResult> {
  const system = buildSystemPrompt(opts);
  const accepted: FlatMessages = {};
  let rejected: TranslateResult["rejected"] = {};
  const total = Object.keys(todo).length;
  const run = async (keys: string[], size: number) => {
    rejected = {};
    const parts = chunk(keys, size);
    let next = 0;
    const worker = async () => {
      while (next < parts.length) {
        const part = parts[next++]!;
        const batch = Object.fromEntries(part.map((k) => [k, todo[k]!]));
        let out: Record<string, unknown> | null = null;
        try {
          out = await callModel(cfg, system, batch);
        } catch {
          out = null;
        }
        for (const k of part) {
          const reason = out ? validateTranslation(k, todo[k]!, out[k], opts) : "missing";
          if (reason === null) accepted[k] = String(out![k]).trim();
          else rejected[k] = reason === "not_string" ? "missing" : reason;
        }
        onProgress?.(Object.keys(accepted).length, total);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency ?? 1) }, worker));
  };
  await run(Object.keys(todo), BATCH_SIZE);
  const retry = Object.keys(rejected);
  if (retry.length > 0) await run(retry, 8);
  return { accepted, rejected };
}
