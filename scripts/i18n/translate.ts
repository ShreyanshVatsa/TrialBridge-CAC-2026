/**
 * `npm run i18n:translate -- <tag> [--provider=groq|local|cerebras|openrouter] [--all-missing] [--force] [--limit=N]`
 * docs/dev/QUESTIONNAIRE_SPEC.md section 6.8. Translates the English keys missing from (or stale in)
 * public/i18n/<tag>.json with Groq (default when GROQ_API_KEY is in .dev.vars) or a local llama-server (--provider=local; ~/models/Qwen3-14B-Q4_K_M.gguf, started
 * and stopped here if not already running) or a configured provider whose data terms are verified.
 * UI strings contain no user data. Never overwrites keys listed in i18n/reviewed/<tag>.keys.json.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { en } from "../../components/i18n/en";
import { getLocale, LOCALES } from "../../config/locales";
import { AI_PROVIDERS } from "../../config/ai-providers";
import { flatten, hashText, type FlatMessages } from "../../lib/i18n/keys";
import { manifestEntry, type Manifest } from "../../lib/i18n/manifest";
import { missingPluralForms, targetKeys, translateKeys, type Glossary, type LlmConfig } from "../../lib/i18n/translate-core";

const SLOTS = Number(process.env.I18N_SLOTS ?? 4);
const ROOT = path.resolve(import.meta.dirname, "../..");
const read = <T>(p: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, p), "utf8")) as T;
  } catch {
    return fallback;
  }
};
const write = (p: string, v: unknown) => {
  mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true });
  writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 1) + "\n");
};

interface State {
  /** hash of the English source text each key was translated from */
  hashes: Record<string, string>;
}

export function writeManifest(): Manifest {
  const enFlat = flatten(en);
  const old = read<Manifest>("public/i18n/manifest.json", { version: 1, source: "en", locales: {} });
  const locales: Manifest["locales"] = {};
  for (const def of LOCALES) {
    const file = `public/i18n/${def.tag}.json`;
    const flat = def.tag === "en" ? enFlat : existsSync(path.join(ROOT, file)) ? read<FlatMessages>(file, {}) : null;
    if (!flat) continue;
    const reviewedKeys = read<string[]>(`i18n/reviewed/${def.tag}.keys.json`, []);
    const prev = old.locales[def.tag];
    const entry = manifestEntry(enFlat, flat, { tag: def.tag, baseStatus: def.baseStatus, reviewedKeys, updated: prev?.updated ?? new Date().toISOString().slice(0, 10) });
    // Keep the previous "updated" date unless something changed.
    locales[def.tag] = prev && prev.sourceHash === entry.sourceHash && prev.coverage === entry.coverage && prev.status === entry.status ? prev : { ...entry, updated: new Date().toISOString().slice(0, 10) };
  }
  const manifest: Manifest = { version: 1, source: "en", locales };
  write("public/i18n/manifest.json", manifest);
  return manifest;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

async function healthy(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    return false;
  }
}

async function ensureLocalServer(): Promise<{ cfg: LlmConfig; stop: () => void }> {
  const env = process.env.LLM_BASE_URL;
  if (env && (await healthy(env.replace(/\/v1$/, "")))) return { cfg: { baseUrl: `${env.replace(/\/v1$/, "")}/v1`, model: "local" }, stop: () => {} };
  const model = process.env.LLM_MODEL_PATH ?? path.join(os.homedir(), "models/Qwen3-14B-Q4_K_M.gguf");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  console.log(`Starting llama-server on :${port} with ${model} ...`);
  const child: ChildProcess = spawn("llama-server", ["-m", model, "--port", String(port), "--host", "127.0.0.1", "-c", String(8192 * SLOTS), "-ngl", "99", "--jinja", "-np", String(SLOTS)], { stdio: "ignore" });
  for (let i = 0; i < 240; i++) {
    if (await healthy(base)) return { cfg: { baseUrl: `${base}/v1`, model: "local", concurrency: SLOTS }, stop: () => child.kill() };
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error("llama-server did not become healthy within 240 s");
}

/** Read one variable from .dev.vars (gitignored) without touching process.env. Never logged. */
function devVar(name: string): string | undefined {
  try {
    const m = readFileSync(path.join(ROOT, ".dev.vars"), "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
    const v = (m?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    return v || undefined;
  } catch {
    return undefined;
  }
}

export class DailyLimitError extends Error {}
let dailyLimitHit = false;

// Groq free tier, openai/gpt-oss-120b (console.groq.com/docs/rate-limits; confirmed by x-ratelimit-* headers):
// 30 RPM, 1000 RPD, 8000 TPM, 200000 TPD. We stay at ~20 requests and ~6000 tokens per rolling minute.
const MAX_RPM = 20;
const MAX_TPM = 6000;
const window: { t: number; tokens: number; id: number }[] = [];
let seq = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reserve(est: number): Promise<number> {
  for (;;) {
    const now = Date.now();
    while (window.length && now - window[0]!.t > 60_000) window.shift();
    const used = window.reduce((a, w) => a + w.tokens, 0);
    if (window.length === 0 || (window.length < MAX_RPM && used + est <= MAX_TPM)) {
      const id = ++seq;
      window.push({ t: now, tokens: est, id });
      return id;
    }
    await sleep(Math.max(250, 60_000 - (now - window[0]!.t) + 50));
  }
}

/** fetch wrapper for Groq: shared pacing, backoff with jitter on 429/5xx honoring Retry-After, body adapted for gpt-oss. */
function groqFetch(key: string, stats: { retries: number }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (dailyLimitHit) throw new DailyLimitError("daily token/request limit reached");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    delete body.chat_template_kwargs;
    body.reasoning_effort = "low";
    const msgs = body.messages as { role: string; content: string }[];
    for (const m of msgs) m.content = m.content.replace(/\n\/no_think$/, "");
    const payload = JSON.stringify(body);
    const valueChars = msgs[1]!.content.length;
    const est = Math.min(7500, Math.ceil(payload.length / 3) + Math.ceil(valueChars) + 400);
    for (let attempt = 0; ; attempt++) {
      const id = await reserve(est);
      const res = await fetch(url, { ...init, body: payload, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${key}` } });
      const slot = window.find((w) => w.id === id);
      if (res.ok) {
        const clone = res.clone();
        try {
          const j = (await clone.json()) as { usage?: { total_tokens?: number } };
          if (slot && j.usage?.total_tokens) slot.tokens = j.usage.total_tokens;
        } catch {}
        return res;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < (process.argv.includes("--wait") ? 500 : 6)) {
        const ra = Number(res.headers.get("retry-after"));
        if (res.status === 429 && ra > 300 && !process.argv.includes("--wait")) {
          try {
            const msg = ((await res.clone().json()) as { error?: { message?: string } }).error?.message ?? "";
            console.warn(`\nGroq 429: ${msg.slice(0, 300)}`);
          } catch {}
          dailyLimitHit = true;
          throw new DailyLimitError(`rate limit with retry-after ${Math.round(ra)} s (daily quota)`);
        }
        stats.retries++;
        const backoff = Math.min(60_000, 2000 * 2 ** attempt) * (0.5 + Math.random() * 0.5);
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 + Math.random() * 500 : backoff); // with --wait this sleeps through the rolling daily quota
        continue;
      }
      return res;
    }
  }) as typeof fetch;
}

function groqConfig(stats: { retries: number }): LlmConfig {
  const p = AI_PROVIDERS.find((x) => x.name === "groq")!;
  const key = process.env.GROQ_API_KEY || devVar("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY is not set (.dev.vars)");
  // Only the app's public interface strings are sent (no user data), so the runtime dataTermsVerified gate
  // (which protects patient input) does not apply to this offline script.
  return { baseUrl: p.baseUrl, model: p.model, concurrency: 4, fetchImpl: groqFetch(key, stats) };
}

function providerConfig(name: string): LlmConfig {
  const p = AI_PROVIDERS.find((x) => x.name === name);
  if (!p) throw new Error(`Unknown provider ${name}`);
  if (!p.dataTermsVerified) throw new Error(`Provider ${name}: dataTermsVerified is false in config/ai-providers.ts`);
  const key = process.env[p.keyEnv];
  if (!key) throw new Error(`Provider ${name}: ${p.keyEnv} is not set`);
  return { baseUrl: p.baseUrl, model: p.model, apiKey: key };
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Map(argv.filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
  const tags = argv.filter((a) => !a.startsWith("--"));
  if (flags.has("manifest")) {
    writeManifest();
    return;
  }
  const targets = flags.has("all-missing") && tags.length === 0 ? LOCALES.filter((l) => l.tag !== "en" && !["es", "pt", "ht"].includes(l.tag) && existsSync(path.join(ROOT, `public/i18n/${l.tag}.json`))).map((l) => l.tag) : tags;
  if (targets.length === 0) throw new Error("Usage: npm run i18n:translate -- <tag> [--provider=groq|local|cerebras|openrouter] [--all-missing] [--force] [--limit=N]");
  const provider = flags.get("provider") ?? (process.env.GROQ_API_KEY || devVar("GROQ_API_KEY") ? "groq" : "local");
  const stats = { retries: 0 };
  const server = provider === "local" ? await ensureLocalServer() : provider === "groq" ? { cfg: groqConfig(stats), stop: () => {} } : { cfg: providerConfig(provider), stop: () => {} };
  const enFlat = flatten(en);
  try {
    for (const tag of targets) {
      const def = getLocale(tag);
      if (!def || tag === "en") throw new Error(`Unknown or source locale: ${tag}`);
      const file = `public/i18n/${tag}.json`;
      const current = read<FlatMessages>(file, {});
      const state = read<State>(`i18n/state/${tag}.json`, { hashes: {} });
      const reviewed = new Set(read<string[]>(`i18n/reviewed/${tag}.keys.json`, []));
      const glossary = read<Glossary>(`i18n/glossary/${tag}.json`, {});
      const want = targetKeys(tag, enFlat);
      // Keys never seen by this workflow (e.g. migrated es/pt/ht) are taken as in sync with the current English.
      for (const k of Object.keys(current)) if (!(k in state.hashes) && k in want) state.hashes[k] = hashText(want[k]!);
      const todo: FlatMessages = {};
      for (const [k, v] of Object.entries(want)) {
        if (reviewed.has(k)) continue;
        const stale = flags.has("force") || (k in current && state.hashes[k] !== hashText(v));
        if (!(k in current) || !current[k] || stale) todo[k] = v;
      }
      const limit = flags.has("limit") ? Number(flags.get("limit")) : Infinity;
      const keys = Object.keys(todo).slice(0, limit);
      const subset = Object.fromEntries(keys.map((k) => [k, todo[k]!]));
      console.log(`[${tag}] ${keys.length} keys to translate (${Object.keys(current).length} existing)`);
      const t0 = Date.now();
      const { accepted, rejected } = keys.length
        ? await translateKeys(subset, server.cfg, { tag, languageName: def.englishName, glossary }, (d, t) => process.stdout.write(`\r[${tag}] ${d}/${t}`))
        : { accepted: {}, rejected: {} };
      if (keys.length) console.log(`\n[${tag}] accepted ${Object.keys(accepted).length}, rejected ${Object.keys(rejected).length} in ${Math.round((Date.now() - t0) / 1000)} s`);
      const merged: FlatMessages = {};
      for (const k of Object.keys(want)) {
        const v = accepted[k] ?? current[k]; // a stale old translation beats English; its hash stays stale so it is retried
        if (v) merged[k] = v;
        if (accepted[k]) state.hashes[k] = hashText(want[k]!);
      }
      for (const k of Object.keys(state.hashes)) if (!(k in want)) delete state.hashes[k];
      const plural = missingPluralForms(tag, merged, enFlat);
      if (plural.length) console.warn(`[${tag}] missing plural forms: ${plural.join(", ")}`);
      if (Object.keys(rejected).length) console.warn(`[${tag}] rejected:`, rejected);
      write(file, merged);
      write(`i18n/state/${tag}.json`, state);
      writeManifest();
      if (dailyLimitHit) {
        console.warn(`[${tag}] stopped: Groq daily quota reached. Re-run later; progress is saved and only missing/stale keys are retried.`);
        break;
      }
    }
    console.log(`provider=${provider} retries=${stats.retries}`);
  } finally {
    server.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

