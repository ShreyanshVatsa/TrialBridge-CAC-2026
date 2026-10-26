import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYZE, handleAnalyze, splitBatches, trimForPrompt, type AnalyzeDeps } from "@/functions/lib/analyze";
import { MemoryKvStore } from "@/functions/lib/store";
import { MemoryTrialStore } from "@/functions/lib/trials";
import { CircuitBreaker } from "@/functions/lib/ai/circuit";
import { mockProvider } from "@/functions/lib/ai/mock";
import { ProviderError, type AiProvider } from "@/functions/lib/ai/types";
import { AnalyzeResponseSchema, type AnalyzeResponse } from "@/lib/types/analysis";
import { minimizeProfile } from "@/lib/privacy/minimize";
import { loadSeedServerTrials } from "./server-fixtures";
import { makeAnswers } from "./fixtures";

const trials = loadSeedServerTrials(20);
const ids = trials.slice(0, 5).map((t) => t.id);
const ORIGIN = "https://trialbridge.example";

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let store: MemoryKvStore;
let breakers: Map<string, CircuitBreaker>;
function deps(over: Partial<AnalyzeDeps> = {}): AnalyzeDeps {
  return {
    env: { ENVIRONMENT: "production", DATA_VERSION: "test", DAILY_BUDGET_GROQ: "100", DAILY_BUDGET_CEREBRAS: "100" } as AnalyzeDeps["env"],
    store,
    trials: new MemoryTrialStore(trials),
    providers: [mockProvider],
    breakerFor: (n) => {
      let b = breakers.get(n);
      if (!b) breakers.set(n, (b = new CircuitBreaker()));
      return b;
    },
    verifyTurnstile: async (t) => t === "ok",
    salt: "salt",
    requestId: "req-1",
    log: () => undefined,
    ...over,
  };
}
const body = (over: object = {}) => ({ profile: minimizeProfile(makeAnswers({ language: "es" })), nctIds: ids, turnstileToken: "ok", ...over });
const read = async (r: Response) => AnalyzeResponseSchema.parse(await r.json());

beforeEach(() => {
  store = new MemoryKvStore();
  breakers = new Map();
});

describe("POST /api/analyze", () => {
  it("returns verified mock analyses built from real trial text", async () => {
    const res = await handleAnalyze(req(body()), deps());
    expect(res.status).toBe(200);
    const data = await read(res);
    expect(data.status).toBe("ok");
    expect(data.provider).toBe("mock");
    // Only the first ANALYZE.maxTrials ids the client sent are explained.
    expect(data.results.map((r) => r.nctId).sort()).toEqual(ids.slice(0, ANALYZE.maxTrials).sort());
    for (const a of data.results) {
      const t = trials.find((x) => x.id === a.nctId);
      for (const c of a.criteria) {
        const list = c.section === "inclusion" ? t?.inclusion : t?.exclusion;
        expect(list?.find((x) => x.n === c.number)?.text).toContain(c.quote);
      }
      expect(a.summary).toMatch(/[áéíóúñ]|equipo/); // Spanish output
    }
  });

  it("serves the second identical request from cache", async () => {
    await handleAnalyze(req(body()), deps());
    const data = await read(await handleAnalyze(req(body()), deps()));
    expect(data.cached).toBe(true);
  });

  it("marks Haitian Creole output experimental", async () => {
    const data = await read(await handleAnalyze(req(body({ profile: minimizeProfile(makeAnswers({ language: "ht" })) })), deps()));
    expect(data.experimental).toBe(true);
  });

  it("rejects cross-origin, bad input, extra fields, oversize bodies, and failed Turnstile", async () => {
    expect((await handleAnalyze(req(body(), { Origin: "https://evil.example" }), deps())).status).toBe(403);
    expect((await handleAnalyze(req({ nope: 1 }), deps())).status).toBe(400);
    expect((await handleAnalyze(req("{not json"), deps())).status).toBe(400);
    expect((await handleAnalyze(req({ ...body(), zip: "02115" }), deps())).status).toBe(400);
    expect((await handleAnalyze(req({ ...body(), profile: { ...body().profile, age: 52 } }), deps())).status).toBe(400);
    expect((await handleAnalyze(req({ ...body(), pad: "x".repeat(20_000) }), deps())).status).toBe(413);
    const ts = await handleAnalyze(req(body({ turnstileToken: "bad" })), deps());
    expect(ts.status).toBe(403);
    expect(((await ts.json()) as { error: { code: string } }).error.code).toBe("turnstile_failed");
    expect((await handleAnalyze(new Request(`${ORIGIN}/api/analyze`, { method: "GET", headers: { Origin: ORIGIN } }), deps())).status).toBe(405);
  });

  it("rate limits at 10 requests per hour per IP hash", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) expect((await handleAnalyze(req(body()), d)).status).toBe(200);
    const res = await handleAnalyze(req(body()), d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await handleAnalyze(req(body(), { "CF-Connecting-IP": "198.51.100.1" }), d)).status).toBe(200);
  });

  it("never trusts trial text from the browser: unknown IDs are ignored", async () => {
    const data = await read(await handleAnalyze(req(body({ nctIds: ["NCT99999999"] })), deps()));
    expect(data.status).toBe("degraded");
    expect(data.results).toEqual([]);
  });

  it("fails over to the next provider on 429 and degrades when all fail", async () => {
    const failing: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete: vi.fn(async () => { throw new ProviderError("rate_limited", "429"); }) };
    const good: AiProvider = { ...mockProvider, name: "cerebras", isMock: false };
    const data = await read(await handleAnalyze(req(body()), deps({ providers: [failing, good] })));
    expect(data.provider).toBe("cerebras");
    const degraded = await read(await handleAnalyze(req(body({ nctIds: ids.slice(0, 2) })), deps({ providers: [failing] })));
    expect(degraded).toMatchObject({ status: "degraded", degradedReason: "rate_limited" } satisfies Partial<AnalyzeResponse>);
  });

  it("retries once with a repair prompt when most quotes are fabricated, then accepts a good answer", async () => {
    const t = trials[0];
    if (!t) throw new Error("no fixture");
    const bad = JSON.stringify({ trials: [{ nctId: t.id, fitLevel: "possible", criteria: [{ section: "inclusion", number: 1, quote: "Patients must be able to fly", assessment: "needs_doctor", explanation: "x" }], doctorQuestions: [], summary: "s" }] });
    const good = await mockProvider.complete({ messages: [], profile: body().profile, trials: [t] });
    const complete = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(good);
    const p: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete };
    const data = await read(await handleAnalyze(req(body({ nctIds: [t.id] })), deps({ providers: [p] })));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(data.status).toBe("ok");
    const second = complete.mock.calls[1]?.[0] as { messages: { content: string }[] };
    expect(second.messages.at(-1)?.content).toMatch(/verbatim|exactly/);
  });

  it("degrades with invalid_output when repair also fails, and budget_exhausted when over budget", async () => {
    const t = trials[0];
    if (!t) throw new Error("no fixture");
    const junk: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete: async () => "not json at all" };
    expect((await read(await handleAnalyze(req(body({ nctIds: [t.id] })), deps({ providers: [junk] })))).degradedReason).toBe("invalid_output");
    const noBudget = deps({ providers: [{ ...mockProvider, name: "groq", isMock: false }], env: { ENVIRONMENT: "production", DAILY_BUDGET_GROQ: "0" } as AnalyzeDeps["env"] });
    expect((await read(await handleAnalyze(req(body({ nctIds: [t.id] })), noBudget))).degradedReason).toBe("budget_exhausted");
  });

  it("reserves prompt plus completion tokens from the daily token budget and degrades when it is used up", async () => {
    const t = trials[0];
    if (!t) throw new Error("no fixture");
    const complete = vi.fn(async () => mockProvider.complete({ messages: [], profile: body().profile, trials: [t] }));
    const p: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete };
    const env = (tokens: string) => ({ ENVIRONMENT: "production", DATA_VERSION: "test", DAILY_BUDGET_GROQ: "100", DAILY_TOKENS_GROQ: tokens }) as AnalyzeDeps["env"];
    const tight = deps({ providers: [p], env: env(String(ANALYZE.maxTokens)) });
    expect((await read(await handleAnalyze(req(body({ nctIds: [t.id] })), tight))).degradedReason).toBe("budget_exhausted");
    expect(complete).not.toHaveBeenCalled();
    const roomy = deps({ providers: [p], env: env("1000000") });
    expect((await read(await handleAnalyze(req(body({ nctIds: [t.id] })), roomy))).status).toBe("ok");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("splits large batches into at most two", () => {
    expect(splitBatches(trials.slice(0, 4), 1e9, () => 1)).toHaveLength(1);
    const two = splitBatches(trials.slice(0, 5), 3, () => 1);
    expect(two.map((b) => b.length)).toEqual([3, 2]);
    expect(splitBatches(trials.slice(0, 1), 0, () => 1)).toHaveLength(1);
  });

  it("trimForPrompt keeps whole criteria in order up to the limit, at least one per section", () => {
    const t = trials[0]!;
    const cut = trimForPrompt(t, 1);
    expect(cut.inclusion).toEqual(t.inclusion.slice(0, 1));
    expect(cut.exclusion).toEqual(t.exclusion.slice(0, 1));
    expect(trimForPrompt(t, 1e9)).toEqual(t);
  });
});
