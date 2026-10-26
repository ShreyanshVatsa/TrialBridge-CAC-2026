import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "@/functions/lib/ai/circuit";
import { MemoryKvStore } from "@/functions/lib/store";
import { checkRateLimit, hashIp } from "@/functions/lib/ratelimit";
import { tryConsumeBudget, tryConsumeTokens } from "@/functions/lib/budget";
import { analysisCacheKey } from "@/functions/lib/cache";
import { stableStringify } from "@/functions/lib/crypto";
import { TURNSTILE_TEST_SECRET, verifyTurnstile } from "@/functions/lib/turnstile";
import { verifyQuotes } from "@/functions/lib/quotes";
import { parseModelOutput } from "@/functions/lib/ai/output";
import { isSameOrigin } from "@/functions/lib/http";
import { createOpenAiCompatibleProvider } from "@/functions/lib/ai/openai-client";
import { dailyBudget, enabledProviderConfigs, resolveProviders } from "@/functions/lib/ai/providers";
import { AI_PROVIDERS } from "@/config/ai-providers";
import { ProviderError } from "@/functions/lib/ai/types";
import { minimizeProfile } from "@/lib/privacy/minimize";
import type { ServerTrial } from "@/functions/lib/trials";
import { makeAnswers } from "./fixtures";

const trial: ServerTrial = {
  id: "NCT00000001", title: "T", summary: "", minAge: 18, maxAge: null, groups: ["breast"], facts: [], barriers: [],
  inclusion: [{ n: 1, text: "Histologically confirmed   HER2-positive breast cancer" }],
  exclusion: [{ n: 1, text: "Pregnant or breastfeeding women" }],
};

describe("circuit breaker", () => {
  it("opens after 3 failures, half-opens after cooldown, closes on success", () => {
    let now = 0;
    const b = new CircuitBreaker(3, 1000, () => now);
    b.recordFailure(); b.recordFailure();
    expect(b.canRequest()).toBe(true);
    b.recordFailure();
    expect(b.state).toBe("open");
    expect(b.canRequest()).toBe(false);
    now = 1000;
    expect(b.state).toBe("half-open");
    b.recordSuccess();
    expect(b.state).toBe("closed");
  });
});

describe("store, rate limit, budget, cache", () => {
  it("memory store honors TTL and counters", async () => {
    let now = 0;
    const s = new MemoryKvStore(() => now);
    await s.put("a", "1", 10);
    expect(await s.get("a")).toBe("1");
    expect(await s.incr("c", 10)).toBe(1);
    expect(await s.incr("c", 10)).toBe(2);
    now = 11_000;
    expect(await s.get("a")).toBeNull();
    expect(await s.incr("c", 10)).toBe(1);
  });
  it("hashes IPs with salt and day (no raw IP), rotating daily", async () => {
    const d1 = new Date("2026-10-06T10:00:00Z");
    const h = await hashIp("203.0.113.9", "salt", d1);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(await hashIp("203.0.113.9", "salt", new Date("2026-10-07T10:00:00Z"))).not.toBe(h);
    expect(await hashIp("203.0.113.9", "other", d1)).not.toBe(h);
  });
  it("limits per hourly window", async () => {
    const s = new MemoryKvStore();
    const now = new Date("2026-10-06T10:30:00Z");
    for (let i = 0; i < 30; i++) expect((await checkRateLimit(s, "ask", "h", now)).allowed).toBe(true);
    const r = await checkRateLimit(s, "ask", "h", now);
    expect(r).toMatchObject({ allowed: false, limit: 30, retryAfter: 1800 });
    expect((await checkRateLimit(s, "ask", "h", new Date("2026-10-06T11:00:00Z"))).allowed).toBe(true);
  });
  it("budget guard", async () => {
    const s = new MemoryKvStore();
    expect(await tryConsumeBudget(s, "groq", 2)).toBe(true);
    expect(await tryConsumeBudget(s, "groq", 2)).toBe(true);
    expect(await tryConsumeBudget(s, "groq", 2)).toBe(false);
    expect(await tryConsumeBudget(s, "x", 0)).toBe(false);
    expect(await tryConsumeBudget(s, "x", Number.NaN)).toBe(false);
  });
  it("token budget guard adds the estimate and allows everything when unset", async () => {
    const s = new MemoryKvStore();
    expect(await tryConsumeTokens(s, "groq", 6000, 10_000)).toBe(true);
    expect(await tryConsumeTokens(s, "groq", 4000, 10_000)).toBe(true);
    expect(await tryConsumeTokens(s, "groq", 1, 10_000)).toBe(false);
    expect(await tryConsumeTokens(s, "groq", 99_999, 0)).toBe(true);
    expect(await tryConsumeTokens(s, "groq", 99_999, Number.NaN)).toBe(true);
  });
  it("cache key is order-insensitive and version-sensitive", async () => {
    const p = minimizeProfile(makeAnswers());
    const a = await analysisCacheKey(p, ["NCT2", "NCT1"], "v1", "p1");
    expect(await analysisCacheKey(p, ["NCT1", "NCT2"], "v1", "p1")).toBe(a);
    expect(await analysisCacheKey(p, ["NCT1", "NCT2"], "v2", "p1")).not.toBe(a);
    expect(await analysisCacheKey({ ...p, language: "es" }, ["NCT1", "NCT2"], "v1", "p1")).not.toBe(a);
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
  });
});

describe("turnstile", () => {
  it("uses the test secret in dev, fails closed without a production secret or on error", async () => {
    const f = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      expect((init?.body as FormData).get("secret")).toBe(TURNSTILE_TEST_SECRET);
      return new Response(JSON.stringify({ success: true }));
    });
    expect(await verifyTurnstile("tok", "1.2.3.4", { ENVIRONMENT: "development" }, f as unknown as typeof fetch)).toBe(true);
    expect(await verifyTurnstile("tok", null, { ENVIRONMENT: "production" }, f as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstile("", null, { ENVIRONMENT: "development" }, f as unknown as typeof fetch)).toBe(false);
    const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", null, { TURNSTILE_SECRET_KEY: "s" }, boom)).toBe(false);
    const no = (async () => new Response(JSON.stringify({ success: false }))) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", null, { TURNSTILE_SECRET_KEY: "s" }, no)).toBe(false);
    const err500 = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", null, { TURNSTILE_SECRET_KEY: "s" }, err500)).toBe(false);
  });
});

describe("quote verification", () => {
  const base = { nctId: "NCT00000001", fitLevel: "possible" as const, doctorQuestions: [], summary: "s" };
  const crit = (quote: string, section: "inclusion" | "exclusion" = "inclusion", number = 1) => ({ section, number, quote, assessment: "needs_doctor" as const, explanation: "e" });
  it("keeps verbatim quotes (whitespace/quote-style tolerant), fixes wrong refs, drops fabricated ones", () => {
    const r = verifyQuotes([{ ...base, criteria: [crit("HER2-positive breast cancer"), crit("Pregnant or breastfeeding", "inclusion", 1), crit("Must be able to fly"), crit("short")] }], [trial]);
    expect(r.total).toBe(4);
    expect(r.failed).toBe(2);
    expect(r.analyses[0]?.criteria.map((c) => `${c.section}${c.number}`)).toEqual(["inclusion1", "exclusion1"]);
  });
  it("drops analyses for unrequested or duplicate trials", () => {
    const r = verifyQuotes([{ ...base, nctId: "NCT00000009", criteria: [] }, { ...base, criteria: [] }, { ...base, criteria: [] }], [trial]);
    expect(r.analyses).toHaveLength(1);
  });
});

describe("model output parsing", () => {
  it("accepts fenced JSON, strips extras, clamps arrays", () => {
    const raw = "```json\n" + JSON.stringify({ trials: [{ nctId: "NCT00000001", fitLevel: "strong", extra: 1, criteria: [{ section: "inclusion", number: "1", quote: "q quote", assessment: "likely_met", explanation: "e" }], doctorQuestions: ["a", "b", "c", "d", "e", "f"], summary: "s" }] }) + "\n```";
    const out = parseModelOutput(raw);
    expect(out[0]?.doctorQuestions).toHaveLength(5);
    expect(out[0]?.criteria[0]?.number).toBe(1);
  });
  it("rejects malformed or invalid output", () => {
    expect(() => parseModelOutput("nope")).toThrow(ProviderError);
    expect(() => parseModelOutput("{bad json}")).toThrow(ProviderError);
    expect(() => parseModelOutput(JSON.stringify({ trials: [{ nctId: "x" }] }))).toThrow(ProviderError);
    expect(() => parseModelOutput(JSON.stringify({ trials: [] }))).toThrow(ProviderError);
  });
});

describe("same-origin check", () => {
  const r = (h: Record<string, string>) => new Request("https://app.example/api/analyze", { method: "POST", headers: h });
  it("accepts same origin, rejects others in production", () => {
    expect(isSameOrigin(r({ Origin: "https://app.example" }), { ENVIRONMENT: "production" })).toBe(true);
    expect(isSameOrigin(r({ Origin: "https://evil.example" }), { ENVIRONMENT: "production" })).toBe(false);
    expect(isSameOrigin(r({ Origin: "http://localhost:3000" }), { ENVIRONMENT: "production" })).toBe(false);
    expect(isSameOrigin(r({ Origin: "http://localhost:3000" }), { ENVIRONMENT: "development" })).toBe(true);
    expect(isSameOrigin(r({ "Sec-Fetch-Site": "same-origin" }), { ENVIRONMENT: "production" })).toBe(true);
    expect(isSameOrigin(r({}), { ENVIRONMENT: "production" })).toBe(false);
  });
});

describe("providers", () => {
  const cfg = AI_PROVIDERS.find((p) => p.name === "groq");
  if (!cfg) throw new Error("no providers");
  it("enables only providers whose data terms were verified (local, groq); all others stay disabled", () => {
    expect(AI_PROVIDERS.filter((p) => p.dataTermsVerified).map((p) => p.name)).toEqual(["local", "groq"]);
    // The local provider only ever talks to this machine.
    expect(AI_PROVIDERS.find((p) => p.name === "local")?.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(resolveProviders({ LOCAL_LLM_API_KEY: "local", GROQ_API_KEY: "k" } as never).map((p) => p.name)).toEqual(["local", "groq"]);
    expect(AI_PROVIDERS.filter((p) => !p.dataTermsVerified).map((p) => p.name).sort()).toEqual(["cerebras", "openrouter"]);
    expect(AI_PROVIDERS.some((p) => /gemini|google/i.test(p.name + p.baseUrl))).toBe(false);
    // Keys for unverified providers never enable them.
    expect(resolveProviders({ CEREBRAS_API_KEY: "k", OPENROUTER_API_KEY: "k" } as never).map((p) => p.name)).toEqual(["mock"]);
    expect(resolveProviders({ GROQ_API_KEY: "k", CEREBRAS_API_KEY: "k", OPENROUTER_API_KEY: "k" } as never).map((p) => p.name)).toEqual(["groq"]);
    expect(resolveProviders({} as never).map((p) => p.name)).toEqual(["mock"]);
  });
  it("enables a provider only with key AND verified terms", () => {
    const reg = [{ ...cfg, dataTermsVerified: true }];
    expect(enabledProviderConfigs({} as never, reg)).toEqual([]);
    expect(enabledProviderConfigs({ GROQ_API_KEY: "k" } as never, reg)).toHaveLength(1);
    expect(resolveProviders({ GROQ_API_KEY: "k" } as never, reg)[0]?.name).toBe("groq");
    expect(dailyBudget({ DAILY_BUDGET_GROQ: "800" } as never, "groq")).toBe(800);
    expect(dailyBudget({} as never, "nope")).toBe(0);
  });
  it("OpenAI-compatible client maps statuses to typed errors", async () => {
    const mk = (res: () => Response | Promise<Response>) => createOpenAiCompatibleProvider(cfg, "key", (async () => res()) as unknown as typeof fetch);
    const req = { messages: [], profile: minimizeProfile(makeAnswers()), trials: [] };
    await expect(mk(() => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }))).complete(req)).resolves.toBe("{}");
    const kind = async (res: () => Response | Promise<Response>) => mk(res).complete(req).catch((e: ProviderError) => e.kind);
    expect(await kind(() => new Response("", { status: 429 }))).toBe("rate_limited");
    expect(await kind(() => new Response("", { status: 503 }))).toBe("server");
    expect(await kind(() => new Response("", { status: 401 }))).toBe("client");
    expect(await kind(() => new Response("not json"))).toBe("invalid_output");
    expect(await kind(() => new Response(JSON.stringify({ choices: [] })))).toBe("invalid_output");
    expect(await kind(() => Promise.reject(new Error("net")))).toBe("network");
  });
});
