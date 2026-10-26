import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "@/functions/lib/ai/circuit";
import { runWithFailover } from "@/functions/lib/ai/failover";
import { ProviderError, type AiProvider } from "@/functions/lib/ai/types";
import { readJsonBody } from "@/functions/lib/http";
import { handleAnalyze, type AnalyzeDeps } from "@/functions/lib/analyze";
import { mockProvider } from "@/functions/lib/ai/mock";
import { MemoryKvStore } from "@/functions/lib/store";
import { MemoryTrialStore } from "@/functions/lib/trials";
import { minimizeProfile } from "@/lib/privacy/minimize";
import { loadSeedServerTrials } from "./server-fixtures";
import { makeAnswers } from "./fixtures";

const provider = (over: Partial<AiProvider> = {}): AiProvider => ({ name: "groq", isMock: false, maxInputChars: 1e9, complete: async () => "{}", ...over });

describe("provider budget counts every request (M7)", () => {
  it("reserves one unit per attempt() reserve call and stops when exhausted", async () => {
    let units = 3;
    const consume = vi.fn(async () => units-- > 0);
    const r = await runWithFailover([provider()], async (_p, reserve) => {
      for (let i = 0; i < 4; i++) await reserve();
      return "done";
    }, { breakerFor: () => new CircuitBreaker(), consumeBudget: consume });
    expect(consume).toHaveBeenCalledTimes(4);
    expect(r).toEqual({ ok: false, reason: "budget_exhausted", lastError: null });
  });
  it("does not trip the circuit breaker on exhausted budget and skips to the next provider", async () => {
    const breaker = new CircuitBreaker(1);
    const r = await runWithFailover([provider({ name: "groq" }), provider({ name: "cerebras" })], async (p, reserve) => {
      await reserve();
      return p.name;
    }, { breakerFor: (n) => (n === "groq" ? breaker : new CircuitBreaker()), consumeBudget: async (p) => p.name === "cerebras" });
    expect(r).toMatchObject({ ok: true, provider: "cerebras" });
    expect(breaker.state).toBe("closed");
  });
  it("analyze reserves budget for the repair retry too", async () => {
    const trials = loadSeedServerTrials(5);
    const t = trials[0];
    if (!t) throw new Error("no fixture");
    const bad = JSON.stringify({ trials: [{ nctId: t.id, fitLevel: "possible", criteria: [{ section: "inclusion", number: 1, quote: "Patients must be able to fly", assessment: "needs_doctor", explanation: "x" }], doctorQuestions: [], summary: "s" }] });
    const complete = vi.fn().mockResolvedValue(bad);
    const store = new MemoryKvStore();
    const deps: AnalyzeDeps = {
      env: { ENVIRONMENT: "production", DATA_VERSION: "t", DAILY_BUDGET_GROQ: "100" } as AnalyzeDeps["env"],
      store,
      trials: new MemoryTrialStore(trials),
      providers: [provider({ complete })],
      breakerFor: () => new CircuitBreaker(),
      verifyTurnstile: async () => true,
      salt: "s",
      requestId: "r",
      log: () => undefined,
    };
    const body = { profile: minimizeProfile(makeAnswers({ language: "en" })), nctIds: [t.id], turnstileToken: "ok" };
    const res = await handleAnalyze(new Request("https://trialbridge.example/api/analyze", { method: "POST", headers: { Origin: "https://trialbridge.example", "Content-Type": "application/json" }, body: JSON.stringify(body) }), deps);
    expect(res.status).toBe(200);
    expect(complete).toHaveBeenCalledTimes(2); // first call + repair
    // two provider requests => two budget units consumed
    expect(await store.incr(`budget:groq:${new Date().toISOString().slice(0, 10)}`, 60)).toBe(3);
  });
  it("mock provider never consumes budget", async () => {
    const consume = vi.fn(async () => false);
    const r = await runWithFailover([mockProvider], async (_p, reserve) => {
      await reserve();
      return 1;
    }, { breakerFor: () => new CircuitBreaker(), consumeBudget: consume });
    expect(r).toMatchObject({ ok: true });
    expect(consume).not.toHaveBeenCalled();
  });
  it("still maps provider errors to failures; a rate limit is reported as such and never opens the circuit", async () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      const r = await runWithFailover([provider()], async () => {
        throw new ProviderError("rate_limited", "429");
      }, { breakerFor: () => breaker, consumeBudget: async () => true });
      expect(r).toMatchObject({ ok: false, reason: "rate_limited" });
    }
    expect(breaker.canRequest()).toBe(true);
    const s = await runWithFailover([provider()], async () => {
      throw new ProviderError("server", "500");
    }, { breakerFor: () => new CircuitBreaker(), consumeBudget: async () => true });
    expect(s).toMatchObject({ ok: false, reason: "ai_unavailable" });
  });
});

describe("circuit breaker half-open probe (L12)", () => {
  it("lets exactly one request through after cooldown until it finishes", () => {
    let now = 0;
    const b = new CircuitBreaker(2, 1000, () => now);
    b.recordFailure();
    b.recordFailure();
    expect(b.canRequest()).toBe(false);
    now = 1000;
    expect(b.state).toBe("half-open");
    expect(b.canRequest()).toBe(true); // probe
    expect(b.canRequest()).toBe(false); // concurrent callers keep skipping
    b.recordFailure();
    expect(b.canRequest()).toBe(false); // re-opened
    now = 2500;
    expect(b.canRequest()).toBe(true);
    b.recordSuccess();
    expect(b.canRequest()).toBe(true);
    expect(b.canRequest()).toBe(true);
    expect(b.state).toBe("closed");
  });
  it("frees an abandoned probe slot after the cooldown", () => {
    let now = 0;
    const b = new CircuitBreaker(1, 1000, () => now);
    b.recordFailure();
    now = 1000;
    expect(b.canRequest()).toBe(true);
    now = 1500;
    expect(b.canRequest()).toBe(false);
    now = 2100;
    expect(b.canRequest()).toBe(true);
  });
});

describe("request body size limit without Content-Length (L11)", () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    });
  it("rejects an oversized chunked body early and accepts a small one", async () => {
    const big = new Request("https://x.example/", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream(Array(40).fill("x".repeat(1000))), duplex: "half" } as RequestInit);
    expect(await readJsonBody(big)).toBeNull();
    const ok = new Request("https://x.example/", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream(['{"a":', "1}"]), duplex: "half" } as RequestInit);
    expect(await readJsonBody(ok)).toEqual({ a: 1 });
    const bad = new Request("https://x.example/", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream(["{nope"]), duplex: "half" } as RequestInit);
    expect(await readJsonBody(bad)).toBeUndefined();
    expect(await readJsonBody(new Request("https://x.example/", { method: "POST", headers: { "Content-Length": "99999" }, body: "{}" }))).toBeNull();
    expect(await readJsonBody(new Request("https://x.example/", { method: "GET" }))).toBeUndefined();
  });
});
