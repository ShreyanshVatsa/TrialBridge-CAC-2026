import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAsk, normalizeQuestion } from "@/functions/lib/ask";
import type { AnalyzeDeps } from "@/functions/lib/analyze";
import { MemoryKvStore } from "@/functions/lib/store";
import { MemoryTrialStore } from "@/functions/lib/trials";
import { CircuitBreaker } from "@/functions/lib/ai/circuit";
import { mockProvider } from "@/functions/lib/ai/mock";
import { ProviderError, type AiProvider } from "@/functions/lib/ai/types";
import { detectCrisis, detectRefusal } from "@/functions/lib/safety";
import { parseAskOutput, verifyCitations } from "@/functions/lib/ai/ask-output";
import { scrubPersonalInfo } from "@/lib/privacy/scrub";
import { AskResponseSchema } from "@/lib/types/ask";
import { askQuestion, questionsRemaining, resetQuestionCountsForTests } from "@/lib/api/ask";
import { loadSeedServerTrials } from "./server-fixtures";

const trials = loadSeedServerTrials(10);
const trial = trials.find((t) => t.inclusion.some((c) => /ECOG/i.test(c.text))) ?? trials[0];
if (!trial) throw new Error("no fixture");
const ORIGIN = "https://trialbridge.example";
const req = (body: object, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.5", ...headers }, body: JSON.stringify(body) });
const body = (question: string, over: object = {}) => ({ nctId: trial.id, question, language: "en", turnstileToken: "ok", ...over });

let store: MemoryKvStore;
let breakers: Map<string, CircuitBreaker>;
const deps = (over: Partial<AnalyzeDeps> = {}): AnalyzeDeps => ({
  env: { ENVIRONMENT: "production", DATA_VERSION: "t", DAILY_BUDGET_GROQ: "100" } as AnalyzeDeps["env"],
  store,
  trials: new MemoryTrialStore(trials),
  providers: [mockProvider],
  breakerFor: (n) => {
    let b = breakers.get(n);
    if (!b) breakers.set(n, (b = new CircuitBreaker()));
    return b;
  },
  verifyTurnstile: async (t) => t === "ok",
  salt: "s",
  requestId: "r",
  log: () => undefined,
  ...over,
});
const ask = async (q: string, over: object = {}, d = deps()) => AskResponseSchema.parse(await (await handleAsk(req(body(q, over)), d)).json());

beforeEach(() => {
  store = new MemoryKvStore();
  breakers = new Map();
});

describe("POST /api/ask safety", () => {
  it("responds to crisis with support and 988, in the user's language, without AI", async () => {
    const complete = vi.fn();
    const r = await ask("I want to end my life", {}, deps({ providers: [{ ...mockProvider, complete }] }));
    expect(r).toMatchObject({ kind: "crisis", crisis: true });
    expect(r.answer).toContain("988");
    expect(complete).not.toHaveBeenCalled();
    const es = await ask("ya no quiero vivir", { language: "es" });
    expect(es.crisis).toBe(true);
    expect(es.answer).toMatch(/988/);
  });
  it("refuses eligibility, diagnosis, and treatment-advice requests", async () => {
    expect((await ask("Am I eligible for this trial?")).refusalReason).toBe("eligibility");
    expect((await ask("Can I join this study?")).refusalReason).toBe("eligibility");
    expect((await ask("What does my biopsy result mean?")).refusalReason).toBe("diagnosis");
    expect((await ask("Should I stop my chemo?")).refusalReason).toBe("treatment_advice");
    const r = await ask("¿Soy elegible?", { language: "es" });
    expect(r.refusalReason).toBe("eligibility");
    expect(r.answer).not.toMatch(/eligible|qualify/);
  });
  it("refuses off-topic questions", async () => {
    const r = await ask("What is a good pizza recipe for dinner tonight?");
    expect(r).toMatchObject({ kind: "refusal", refusalReason: "off_topic" });
  });
  it("answers only from the trial text with verified citations", async () => {
    const r = await ask("What ECOG performance status is required?");
    expect(r.kind).toBe("answer");
    expect(r.citations.length).toBeGreaterThan(0);
    for (const c of r.citations) {
      const src = c.section === "inclusion" ? trial.inclusion.find((x) => x.n === c.number)?.text : c.section === "exclusion" ? trial.exclusion.find((x) => x.n === c.number)?.text : c.section === "summary" ? trial.summary : trial.title;
      expect(src).toContain(c.quote);
    }
  });
  it("says when the text doesn't answer", async () => {
    const r = await ask("How much parking costs for the study?");
    expect(r.kind).toBe("not_in_text");
  });
  it("scrubs personal info before processing", async () => {
    const complete = vi.fn(mockProvider.complete);
    const r = await ask("My zip is 02115 and phone 617-555-1234, what ECOG status is needed?", {}, deps({ providers: [{ ...mockProvider, complete }] }));
    expect(r.piiRemoved).toBe(true);
    const sent = JSON.stringify(complete.mock.calls[0]?.[0]);
    expect(sent).not.toContain("02115");
    expect(sent).not.toContain("617-555-1234");
  });
  it("turns an uncited model answer into not_in_text and drops fabricated quotes", async () => {
    const p: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete: async () => JSON.stringify({ kind: "answer", answer: "Yes, anyone can join.", citations: [{ section: "inclusion", number: 1, quote: "Anyone of any age may join this trial" }] }) };
    expect((await ask("What ECOG performance status is required?", {}, deps({ providers: [p] }))).kind).toBe("not_in_text");
  });
  it("caches, rate limits at 30/hour, checks Turnstile, 404s unknown trials, degrades on failure", async () => {
    await ask("What ECOG performance status is required?");
    expect((await ask("what ECOG performance status is required")).cached).toBe(true);
    expect((await handleAsk(req(body("x?", { turnstileToken: "bad" })), deps())).status).toBe(403);
    expect((await handleAsk(req(body("What ECOG status?", { nctId: "NCT99999999" })), deps())).status).toBe(404);
    expect((await handleAsk(req({ ...body("q?"), extra: 1 }), deps())).status).toBe(400);
    expect((await handleAsk(req(body("x".repeat(301))), deps())).status).toBe(400);
    expect((await handleAsk(req(body("q"), { Origin: "https://evil.example" }), deps())).status).toBe(403);
    const failing: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete: async () => { throw new ProviderError("server", "500"); } };
    expect((await ask("Which inclusion criteria apply to prior therapy?", {}, deps({ providers: [failing] }))).status).toBe("degraded");
    const d = deps();
    store = new MemoryKvStore();
    const d2 = { ...d, store };
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await handleAsk(req(body(`Is the ECOG ${i} ok?`)), d2)).status;
    expect(last).toBe(429);
  });
  it("reserves prompt plus completion tokens from the daily token budget and degrades when it is used up", async () => {
    const complete = vi.fn(async () => JSON.stringify({ kind: "answer", answer: "Yes, anyone can join.", citations: [{ section: "inclusion", number: 1, quote: "Anyone of any age may join this trial" }] }));
    const p: AiProvider = { name: "groq", isMock: false, maxInputChars: 1e9, complete };
    const env = (tokens: string) => ({ ENVIRONMENT: "production", DATA_VERSION: "t", DAILY_BUDGET_GROQ: "100", DAILY_TOKENS_GROQ: tokens }) as AnalyzeDeps["env"];
    const tight = await ask("What is the study drug?", {}, deps({ providers: [p], env: env("6000") }));
    expect(tight).toMatchObject({ status: "degraded", degradedReason: "budget_exhausted" });
    expect(complete).not.toHaveBeenCalled();
    const roomy = await ask("What is the study drug?", {}, deps({ providers: [p], env: env("1000000") }));
    expect(roomy.status).toBe("ok");
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("normalizes questions for caching", () => {
    expect(normalizeQuestion("  Who can JOIN?? ")).toBe("who can join");
  });
});

describe("safety and scrub helpers", () => {
  it("detects crisis and refusals across languages, ignores normal questions", () => {
    expect(detectCrisis("pensando en matarme")).toBe(true);
    expect(detectCrisis("quero morrer")).toBe(true);
    expect(detectCrisis("mwen vle mouri")).toBe(true);
    expect(detectCrisis("Does the drug cause hair loss?")).toBe(false);
    expect(detectRefusal("posso participar?")).toBe("eligibility");
    expect(detectRefusal("What is being tested?")).toBeNull();
  });
  it("scrubs emails, phones, SSNs, dates, ZIPs, long numbers", () => {
    const r = scrubPersonalInfo("Email a.b@x.com, call (617) 555-1234, SSN 123-45-6789, born 03/04/1961, DOB March 4, 1961, zip 02115-1234, MRN 12345678");
    for (const s of ["a.b@x.com", "555-1234", "123-45-6789", "03/04/1961", "1961", "02115", "12345678"]) expect(r.text).not.toContain(s);
    expect(r.removed).toBeGreaterThanOrEqual(7);
    expect(scrubPersonalInfo("Is a phase 2 trial safe?").removed).toBe(0);
  });
  it("parses and verifies model output", () => {
    expect(() => parseAskOutput("nah")).toThrow(ProviderError);
    expect(() => parseAskOutput("{oops}")).toThrow(ProviderError);
    expect(() => parseAskOutput(JSON.stringify({ kind: "maybe" }))).toThrow(ProviderError);
    const out = parseAskOutput(JSON.stringify({ kind: "refusal", answer: "no", citations: [{ section: "title", number: 3, quote: trial.title }] }));
    expect(out.refusalReason).toBe("off_topic");
    expect(out.citations[0]?.number).toBeNull();
    expect(verifyCitations(out.citations, trial)).toHaveLength(1);
    expect(verifyCitations([{ section: "summary", number: null, quote: "short" }], trial)).toHaveLength(0);
  });
});

describe("askQuestion client", () => {
  beforeEach(() => resetQuestionCountsForTests());
  it("scrubs before sending, enforces 10 per trial per session, degrades on errors", async () => {
    const sent: string[] = [];
    const ok = { status: "ok", kind: "answer", answer: "a", citations: [], crisis: false, piiRemoved: false, experimental: false, cached: false, provider: "mock" };
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(JSON.stringify(ok));
    }));
    const r = await askQuestion("NCT00000001", "my zip is 02115, what is tested?", "en", "tok");
    expect(r.piiRemoved).toBe(true);
    expect(sent[0]).not.toContain("02115");
    for (let i = 0; i < 9; i++) await askQuestion("NCT00000001", "q?", "en", "tok");
    expect(questionsRemaining("NCT00000001")).toBe(0);
    expect((await askQuestion("NCT00000001", "q?", "en", "tok")).degradedReason).toBe("question_limit");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "m", requestId: "r" } }), { status: 429 })));
    expect((await askQuestion("NCT00000002", "q?", "es", "tok")).degradedReason).toBe("rate_limited");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await askQuestion("NCT00000002", "q?", "ht", "tok"))).toMatchObject({ degradedReason: "ai_unavailable", experimental: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    expect((await askQuestion("NCT00000002", "q?", "en", "tok")).degradedReason).toBe("invalid_output");
    vi.unstubAllGlobals();
  });
});
