import { beforeEach, describe, expect, it } from "vitest";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import { minimizeProfile } from "@/lib/privacy/minimize";
import { MatchResponseSchema } from "@/lib/types/match-judge";
import { MATCH_JUDGE } from "@/config/match-judge";
import { MATCH_PROMPT_VERSION, MATCH_SYSTEM_PROMPT, buildMatchUserPrompt, numberAnswers } from "@/prompts/analyze-v3";
import { DOWNGRADE_REASON, capWords, parseMatchJson, validateMatchOutput } from "@/functions/lib/ai/match-output";
import { chunkChars, handleMatch, judgeCacheKey, judgeCriteria, planBatches, type JudgeDeps, type JudgeTrialInput } from "@/functions/lib/match";
import type { AnalyzeDeps } from "@/functions/lib/analyze";
import { MemoryKvStore } from "@/functions/lib/store";
import { MemoryTrialStore, type ServerTrial } from "@/functions/lib/trials";
import { CircuitBreaker } from "@/functions/lib/ai/circuit";
import { mockProvider } from "@/functions/lib/ai/mock";
import { createOpenAiCompatibleProvider } from "@/functions/lib/ai/openai-client";
import { ProviderError, type AiProvider, type CompletionRequest } from "@/functions/lib/ai/types";
import { makeAnswers } from "./fixtures";

// Synthetic criteria (test fixtures, not real trial text).
const inc = (n: number, text: string): SplitCriterion => ({ id: `I${n}`, section: "inclusion", text });
const exc = (n: number, text: string): SplitCriterion => ({ id: `E${n}`, section: "exclusion", text });
const ITEMS: SplitCriterion[] = [inc(1, "Age 18 years or older"), inc(2, "Measurable disease per RECIST 1.1"), exc(1, "Pregnant or breastfeeding"), exc(2, "Active hepatitis B")];
const T1 = "NCT00000001";
const T2 = "NCT00000002";
const profile = minimizeProfile(makeAnswers());
const answers = numberAnswers(profile);
const ANSWER_IDS = new Set(answers.map((a) => a.id));

type Reply = (req: CompletionRequest) => string;
/** A scripted fake provider: records every request, answers with `reply`. */
function fakeProvider(name: string, reply: Reply, maxInputChars = 60_000): AiProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    name,
    isMock: false,
    maxInputChars,
    calls,
    async complete(req) {
      calls.push(req);
      return reply(req);
    },
  };
}
/** Reply that labels every sent item with a fixed label per section, citing A1. */
const labelAll: Reply = (req) =>
  JSON.stringify({
    trials: (req.match?.trials ?? []).map((t) => ({
      trialId: t.trialId,
      items: t.items.map((c) => ({ id: c.id, label: c.section === "inclusion" ? "met" : "not_excluded", reason: "Your age range fits.", answerIds: ["A2"] })),
    })),
  });

let store: MemoryKvStore;
let breakers: Map<string, CircuitBreaker>;
const breakerFor = (n: string) => {
  let b = breakers.get(n);
  if (!b) breakers.set(n, (b = new CircuitBreaker()));
  return b;
};
function jdeps(providers: AiProvider[], over: Partial<JudgeDeps> = {}): JudgeDeps {
  return { store, providers, breakerFor, consumeBudget: async () => true, ...over };
}
const input = (trialId: string, items: SplitCriterion[] = ITEMS): JudgeTrialInput => ({ trialId, criteriaVersion: 1, items, title: "Synthetic trial" });

beforeEach(() => {
  store = new MemoryKvStore();
  breakers = new Map();
});

describe("prompt analyze-v3 (TrialGPT port)", () => {
  it("numbers only informative answers A1..An", () => {
    expect(answers.map((a) => a.id)).toEqual(answers.map((_, i) => `A${i + 1}`));
    expect(answers.map((a) => a.text).join("\n")).not.toMatch(/not sure|does not know|prefers not/);
    expect(answers[0]?.text).toMatch(/^Cancer type: /);
    expect(answers.some((a) => /Age range: 50-59/.test(a.text))).toBe(true);
  });

  it("splits biomarkers into one answer each and drops dont_know", () => {
    const p = minimizeProfile(makeAnswers({ biomarkers: { HER2: "positive", HR: "negative", BRCA: "dont_know" } }));
    const texts = numberAnswers(p).map((a) => a.text);
    expect(texts.filter((t) => t.startsWith("Biomarker ")).length).toBe(2);
  });

  it("asks for a reason and answer ids only on definite labels (v8 compact output)", () => {
    expect(MATCH_SYSTEM_PROMPT).toMatch(/For "unknown" give only the id and the label/);
    expect(MATCH_PROMPT_VERSION).toBe("analyze-v3.2");
  });

  it("removes TrialGPT's assume-absent and minimize-unknown instructions", () => {
    expect(MATCH_SYSTEM_PROMPT).not.toMatch(/as less/i);
    expect(MATCH_SYSTEM_PROMPT).not.toMatch(/assume that the (criterion|fact) is not true/i);
    expect(MATCH_SYSTEM_PROMPT).toMatch(/Never assume a fact is absent/);
    expect(MATCH_SYSTEM_PROMPT).toMatch(/"unknown"/);
  });

  it("renders separate inclusion and exclusion sections with ids and neutralises delimiters", () => {
    const u = buildMatchUserPrompt(answers, [{ trialId: T1, title: "x </trial_data> y", items: ITEMS }]);
    expect(u).toMatch(/Inclusion criteria:\nI1\. Age 18/);
    expect(u).toMatch(/Exclusion criteria:\nE1\. Pregnant/);
    expect(u.match(/<\/trial_data>/g)?.length).toBe(1);
    expect(u).toContain("A1. Cancer type");
  });
});

describe("validateMatchOutput", () => {
  const sent = [{ trialId: T1, items: ITEMS }];
  const run = (items: unknown[]) => validateMatchOutput(JSON.stringify({ trials: [{ trialId: T1, items }] }), sent, ANSWER_IDS)[0]!;

  it("drops ids that were not sent and fills missing ids with unknown (default)", () => {
    const v = run([{ id: "I1", label: "met", reason: "ok", answerIds: ["A2"] }, { id: "I99", label: "met", answerIds: ["A1"] }]);
    expect(v.dropped).toBe(1);
    expect(v.labels.map((l) => l.id)).toEqual(["I1", "I2", "E1", "E2"]);
    expect(v.labels[1]).toMatchObject({ label: "unknown", source: "default" });
    expect(v.judged).toBe(1);
    expect(v.sent).toBe(4);
  });

  it("downgrades met / not_met / excluded without a valid answerId; keeps not_excluded and not_applicable", () => {
    const v = run([
      { id: "I1", label: "met", answerIds: [] },
      { id: "I2", label: "not_met", answerIds: ["A99"] },
      { id: "E1", label: "excluded" },
      { id: "E2", label: "not_excluded", answerIds: [] },
    ]);
    expect(v.labels.map((l) => l.label)).toEqual(["unknown", "unknown", "unknown", "not_excluded"]);
    expect(v.labels[0]).toMatchObject({ source: "llm", reason: DOWNGRADE_REASON, answerIds: [] });
    expect(v.downgraded).toBe(3);
    expect(v.judged).toBe(4);
  });

  it("filters invalid answerIds but keeps valid ones", () => {
    const v = run([{ id: "E1", label: "not_excluded", answerIds: ["A3", "A42", "a3"] }]);
    expect(v.labels[2]?.answerIds).toEqual(["A3"]);
  });

  it("rejects a label from the wrong section, accepts TrialGPT aliases", () => {
    const v = run([
      { id: "I1", label: "excluded", answerIds: ["A1"] },
      { id: "I2", label: "not enough information" },
      { id: "E1", label: "Not Applicable" },
    ]);
    expect(v.labels.map((l) => [l.label, l.source])).toEqual([["unknown", "default"], ["unknown", "llm"], ["not_applicable", "llm"], ["unknown", "default"]]);
    expect(v.judged).toBe(2);
  });

  it("accepts the compact shape: an unknown item is just its id and label, and counts as judged", () => {
    const v = run([
      { id: "I1", label: "met", answerIds: ["A1"], reason: "Age fits." },
      { id: "I2", label: "unknown" },
      { id: "E1", label: "unknown" },
    ]);
    expect(v.judged).toBe(3);
    expect(v.labels[1]).toMatchObject({ id: "I2", label: "unknown", source: "llm", answerIds: [] });
    expect(v.labels[1]?.reason).toBeUndefined();
  });

  it("caps reasons at the word limit and neutralises eligibility claims", () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const v = run([
      { id: "I1", label: "met", reason: long, answerIds: ["A2"] },
      { id: "I2", label: "met", reason: "You are eligible for this trial.", answerIds: ["A1"] },
    ]);
    expect(v.labels[0]?.reason?.split(" ").length).toBe(MATCH_JUDGE.reasonMaxWords);
    expect(v.labels[1]?.reason).not.toMatch(/eligible/);
    expect(capWords("a b c", 2)).toBe("a b…");
  });

  it("first answer for a duplicated id wins; a trial missing from the output is all unknown", () => {
    const two = [...sent, { trialId: T2, items: ITEMS }];
    const out = validateMatchOutput(JSON.stringify({ trials: [{ trialId: T1, items: [{ id: "I1", label: "met", answerIds: ["A1"] }, { id: "I1", label: "not_met", answerIds: ["A1"] }] }] }), two, ANSWER_IDS);
    expect(out[0]?.labels[0]?.label).toBe("met");
    expect(out[1]?.judged).toBe(0);
    expect(out[1]?.labels.every((l) => l.label === "unknown")).toBe(true);
  });

  it("accepts a bare single-trial object and rejects non-JSON", () => {
    const v = validateMatchOutput('```json\n{"trialId":"NCT00000001","items":[{"id":"I1","label":"met","answerIds":["A2"]}]}\n```', sent, ANSWER_IDS);
    expect(v[0]?.judged).toBe(1);
    expect(() => validateMatchOutput("sorry", sent, ANSWER_IDS)).toThrow(ProviderError);
    expect(() => validateMatchOutput("{not json}", sent, ANSWER_IDS)).toThrow(ProviderError);
    expect(() => validateMatchOutput('{"trials":"x"}', sent, ANSWER_IDS)).toThrow(ProviderError);
  });
});

describe("planBatches", () => {
  const t = (id: string, n: number) => ({ trialId: id, items: Array.from({ length: n }, (_, i) => inc(i + 1, `Criterion number ${i + 1} with some words in it`)) });

  it("keeps everything in one batch under the limit", () => {
    expect(planBatches([t(T1, 3), t(T2, 3)], 60_000, 1000)).toHaveLength(1);
  });

  it("packs whole trials into several batches under maxInputChars", () => {
    const trials = [t(T1, 5), t(T2, 5), t("NCT00000003", 5)];
    const one = chunkChars(trials[0]!);
    const batches = planBatches(trials, 2 * one + 100, 100);
    expect(batches.map((b) => b.map((x) => x.trialId))).toEqual([[T1, T2], ["NCT00000003"]]);
    for (const b of batches) expect(b.reduce((s, x) => s + chunkChars(x), 0)).toBeLessThanOrEqual(2 * one);
  });

  it("chunks an oversized trial by items without losing any", () => {
    const big = t(T1, 40);
    const batches = planBatches([big], 600, 100);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().flatMap((x) => x.items.map((c) => c.id))).toEqual(big.items.map((c) => c.id));
    for (const b of batches) expect(b.reduce((s, x) => s + chunkChars(x), 0)).toBeLessThanOrEqual(500);
  });
});

describe("judgeCacheKey", () => {
  it("is stable and changes with trialId, criteriaVersion, promptVersion, profile and content", async () => {
    const base = await judgeCacheKey(T1, 1, "analyze-v3", profile, "h");
    const reordered = Object.fromEntries(Object.entries(profile).reverse()) as typeof profile;
    expect(await judgeCacheKey(T1, 1, "analyze-v3", reordered, "h")).toBe(base);
    expect(base).toMatch(/^mj:[0-9a-f]{64}$/);
    const variants = await Promise.all([
      judgeCacheKey(T2, 1, "analyze-v3", profile, "h"),
      judgeCacheKey(T1, 2, "analyze-v3", profile, "h"),
      judgeCacheKey(T1, 1, "analyze-v4", profile, "h"),
      judgeCacheKey(T1, 1, "analyze-v3", { ...profile, ageBracket: "60-69" }, "h"),
      judgeCacheKey(T1, 1, "analyze-v3", profile, "other"),
    ]);
    expect(new Set([base, ...variants]).size).toBe(6);
  });
});

describe("judgeCriteria", () => {
  it("returns llm labels with provider, coverage and prompt version, then serves the cache", async () => {
    const p = fakeProvider("groq", labelAll);
    const first = await judgeCriteria(profile, [input(T1), input(T2)], jdeps([p]));
    expect(first.ok).toBe(true);
    expect(first.results.map((r) => r.trialId)).toEqual([T1, T2]);
    expect(first.results[0]).toMatchObject({ provider: "groq", criteriaVersion: 1, coverage: 1, promptVersion: MATCH_PROMPT_VERSION });
    expect(first.results[0]?.labels.map((l) => l.label)).toEqual(["met", "met", "not_excluded", "not_excluded"]);
    expect(first.results[0]?.labels.every((l) => l.source === "llm")).toBe(true);
    expect(p.calls).toHaveLength(1);
    // Real providers never receive the structured profile, only the prompt text.
    expect(p.calls[0]?.profile).toBeUndefined();

    const second = await judgeCriteria(profile, [input(T1), input(T2)], jdeps([p]));
    expect(p.calls).toHaveLength(1);
    expect(second.cachedIds).toEqual([T1, T2]);
    expect(second.results).toEqual(first.results);
  });

  it("records partial coverage and downgrades in the result", async () => {
    const p = fakeProvider("groq", () => JSON.stringify({ trials: [{ trialId: T1, items: [{ id: "I1", label: "met" }, { id: "E1", label: "not_excluded", answerIds: ["A3"] }] }] }));
    const r = await judgeCriteria(profile, [input(T1)], jdeps([p]));
    expect(r.results[0]?.coverage).toBe(0.5);
    expect(r.results[0]?.labels.map((l) => l.label)).toEqual(["unknown", "unknown", "not_excluded", "unknown"]);
  });

  it("batches under maxInputChars and merges chunks of one trial", async () => {
    const many = Array.from({ length: 30 }, (_, i) => inc(i + 1, `Synthetic inclusion criterion ${i + 1} about labs and organ function`));
    const overhead = MATCH_SYSTEM_PROMPT.length + buildMatchUserPrompt(answers, []).length;
    const p = fakeProvider("groq", labelAll, overhead + 900);
    const r = await judgeCriteria(profile, [input(T1, many), input(T2)], jdeps([p]));
    expect(p.calls.length).toBeGreaterThan(2);
    for (const c of p.calls) expect(c.messages.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(overhead + 900);
    expect(r.results[0]?.labels.map((l) => l.id)).toEqual(many.map((c) => c.id));
    expect(r.results[0]?.coverage).toBe(1);
  });

  it("stops starting model calls once the request deadline has passed, keeps the batches already judged (no unbounded sequential batches)", async () => {
    const many = Array.from({ length: 90 }, (_, i) => inc(i + 1, `Synthetic inclusion criterion ${i + 1} about labs and organ function`));
    const overhead = MATCH_SYSTEM_PROMPT.length + buildMatchUserPrompt(answers, []).length;
    const slow = fakeProvider("groq", labelAll, overhead + 900);
    const inner = slow.complete.bind(slow);
    slow.complete = async (req) => {
      await new Promise((r) => setTimeout(r, 60));
      return inner(req);
    };
    const backup = fakeProvider("cerebras", labelAll, overhead + 900);
    const r = await judgeCriteria(profile, [input(T1, many)], jdeps([slow, backup], { deadlineMs: 100 }));
    expect(r.ok && r.provider).toBe("groq");
    expect(r.results[0]?.labels).toHaveLength(90);
    expect(r.results[0]?.coverage).toBeGreaterThan(0);
    expect(r.results[0]?.coverage).toBeLessThan(1);
    expect(slow.calls.length).toBeLessThan(5);
    expect(slow.calls.every((c) => c.signal !== undefined)).toBe(true);
    expect(backup.calls).toHaveLength(0);
    expect(breakerFor("cerebras").canRequest()).toBe(true);
  });

  it("caps batches at MATCH_JUDGE.maxBatchChars and sends the eval-proven completion settings", async () => {
    const many = Array.from({ length: 300 }, (_, i) => inc(i + 1, `Synthetic inclusion criterion ${i + 1} about labs, organ function and prior therapy windows`));
    const p = fakeProvider("groq", labelAll, 60_000);
    await judgeCriteria(profile, [input(T1, many.slice(0, 120)), input(T2, many.slice(120, 240))], jdeps([p]));
    expect(p.calls.length).toBeGreaterThan(1);
    for (const c of p.calls) {
      expect(c.messages.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(MATCH_JUDGE.maxBatchChars);
      expect(c.maxTokens).toBe(MATCH_JUDGE.maxTokens);
      expect(c.reasoningEffort).toBe("low");
    }
  });

  it("OpenAI-compatible client forwards maxTokens and reasoningEffort, default 6000 and none", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createOpenAiCompatibleProvider({ name: "groq", baseUrl: "https://example.invalid", model: "m", keyEnv: "GROQ_API_KEY", budgetEnv: "DAILY_BUDGET_GROQ", dataTermsVerified: true, maxInputChars: 60_000 }, "test-key", fetchImpl);
    await client.complete({ messages: [], trials: [], maxTokens: 3500, reasoningEffort: "low" });
    await client.complete({ messages: [], trials: [] });
    expect(bodies[0]).toMatchObject({ max_tokens: 3500, reasoning_effort: "low" });
    expect(bodies[1]?.max_tokens).toBe(6000);
    expect(bodies[1]).not.toHaveProperty("reasoning_effort");
  });

  it("keeps the batches that passed when one batch stays malformed, and does not cache the partial trial", async () => {
    const many = Array.from({ length: 30 }, (_, i) => inc(i + 1, `Synthetic inclusion criterion ${i + 1} about labs and organ function`));
    const overhead = MATCH_SYSTEM_PROMPT.length + buildMatchUserPrompt(answers, []).length;
    let call = 0;
    // Batch 2 (calls 2 and 3: first try and its re-ask) is malformed; every other call answers.
    const p = fakeProvider("groq", (req) => (++call === 2 || call === 3 ? "not json" : labelAll(req)), overhead + 900);
    const r = await judgeCriteria(profile, [input(T1, many), input(T2)], jdeps([p]));
    expect(r.ok && r.provider).toBe("groq");
    const t1 = r.results.find((x) => x.trialId === T1);
    expect(t1?.labels).toHaveLength(30);
    expect(t1?.coverage).toBeGreaterThan(0);
    expect(t1?.coverage).toBeLessThan(1);
    expect(t1?.labels.some((l) => l.source === "default")).toBe(true);
    expect(t1?.labels.some((l) => l.source === "llm")).toBe(true);
    const again = await judgeCriteria(profile, [input(T1, many), input(T2)], jdeps([fakeProvider("groq", labelAll, overhead + 900)]));
    expect(again.cachedIds).not.toContain(T1);
  });

  it("fails over only when no batch produced a usable answer", async () => {
    const many = Array.from({ length: 30 }, (_, i) => inc(i + 1, `Synthetic inclusion criterion ${i + 1} about labs and organ function`));
    const overhead = MATCH_SYSTEM_PROMPT.length + buildMatchUserPrompt(answers, []).length;
    const bad = fakeProvider("groq", () => "not json", overhead + 900);
    const good = fakeProvider("cerebras", labelAll, overhead + 900);
    const r = await judgeCriteria(profile, [input(T1, many)], jdeps([bad, good]));
    expect(r.ok && r.provider).toBe("cerebras");
    expect(r.results[0]?.coverage).toBe(1);
  });

  it("reserves the estimated tokens of every request (prompt + completion cap)", async () => {
    const reserved: (number | undefined)[] = [];
    const p = fakeProvider("groq", labelAll);
    await judgeCriteria(profile, [input(T1)], jdeps([p], { consumeBudget: async (_p, tokens) => (reserved.push(tokens), true) }));
    const chars = p.calls[0]?.messages.reduce((s, m) => s + m.content.length, 0) ?? 0;
    expect(reserved).toEqual([Math.ceil(chars / 3.5) + MATCH_JUDGE.maxTokens]);
  });

  it("client waits out a short 429 retry-after once, and fails fast on a long one", async () => {
    const cfg = { name: "groq", baseUrl: "https://example.invalid", model: "m", keyEnv: "GROQ_API_KEY", budgetEnv: "DAILY_BUDGET_GROQ", dataTermsVerified: true, maxInputChars: 60_000 } as const;
    const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
    const limited = (secs: string) => new Response("", { status: 429, headers: { "retry-after": secs } });
    let n = 0;
    const shortFetch = (async () => (n++ === 0 ? limited("0.05") : ok())) as unknown as typeof fetch;
    expect(await createOpenAiCompatibleProvider(cfg, "k", shortFetch).complete({ messages: [], trials: [] })).toBe("{}");
    expect(n).toBe(2);
    let m = 0;
    const longFetch = (async () => (m++, limited("3600"))) as unknown as typeof fetch;
    await expect(createOpenAiCompatibleProvider(cfg, "k", longFetch).complete({ messages: [], trials: [] })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(m).toBe(1);
    let k = 0;
    const twiceFetch = (async () => (k++, limited("0"))) as unknown as typeof fetch;
    await expect(createOpenAiCompatibleProvider(cfg, "k", twiceFetch).complete({ messages: [], trials: [] })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(k).toBe(2);
    // With a deadline signal it keeps waiting out short limits (the token bucket refills gradually).
    let j = 0;
    const thriceFetch = (async () => (j++ < 3 ? limited("0") : ok())) as unknown as typeof fetch;
    expect(await createOpenAiCompatibleProvider(cfg, "k", thriceFetch).complete({ messages: [], trials: [], signal: AbortSignal.timeout(20_000) })).toBe("{}");
    expect(j).toBe(4);
  }, 20_000);

  it("re-asks a batch once after malformed output before failing over", async () => {
    let n = 0;
    const flaky = fakeProvider("groq", (req) => (n++ === 0 ? '[{"trials":[]},"trialId"]' : labelAll(req)));
    const r = await judgeCriteria(profile, [input(T1)], jdeps([flaky]));
    expect(r.ok && r.provider).toBe("groq");
    expect(flaky.calls).toHaveLength(2);
    expect(r.results[0]?.coverage).toBe(1);
  });

  it("fails over on invalid output, and to the mock (all unknown, never cached)", async () => {
    const bad = fakeProvider("groq", () => "not json");
    const zero = fakeProvider("cerebras", () => JSON.stringify({ trials: [] }));
    const r = await judgeCriteria(profile, [input(T1)], jdeps([bad, zero, mockProvider]));
    expect(r.ok && r.provider).toBe("mock");
    expect(r.results[0]?.labels.every((l) => l.label === "unknown" && (l.answerIds ?? []).length === 0)).toBe(true);
    const again = await judgeCriteria(profile, [input(T1)], jdeps([mockProvider]));
    expect(again.cachedIds).toEqual([]);
  });

  it("skips a provider whose budget is spent and degrades when none is left", async () => {
    const p = fakeProvider("groq", labelAll);
    const r = await judgeCriteria(profile, [input(T1)], jdeps([p], { consumeBudget: async () => false }));
    expect(r).toMatchObject({ ok: false, reason: "budget_exhausted" });
    expect(p.calls).toHaveLength(0);
  });

  it("respects an open circuit breaker", async () => {
    const p = fakeProvider("groq", () => {
      throw new ProviderError("server", "500");
    });
    for (let i = 0; i < 3; i++) await judgeCriteria(profile, [input(T1)], jdeps([p]));
    expect(p.calls).toHaveLength(3);
    const r = await judgeCriteria(profile, [input(T1)], jdeps([p]));
    expect(p.calls).toHaveLength(3);
    expect(r.ok).toBe(false);
  });

  it("does not call the model for a trial with nothing unknown, and caps at topN trials", async () => {
    const p = fakeProvider("groq", labelAll);
    const r = await judgeCriteria(profile, [input(T1, [])], jdeps([p]));
    expect(p.calls).toHaveLength(0);
    expect(r.results[0]).toMatchObject({ labels: [], coverage: 1 });
    const ids = Array.from({ length: MATCH_JUDGE.topN + 3 }, (_, i) => `NCT${String(i + 10).padStart(8, "0")}`);
    const capped = await judgeCriteria(profile, ids.map((id) => input(id)), jdeps([p]));
    expect(capped.results).toHaveLength(MATCH_JUDGE.topN);
  });
});

describe("POST /api/match", () => {
  const ORIGIN = "https://trialbridge.example";
  const server = (id: string, over: Partial<ServerTrial> = {}): ServerTrial => ({
    id,
    title: "Synthetic trial",
    summary: "Synthetic summary",
    inclusion: [{ n: 1, text: "Age 18 years or older" }],
    exclusion: [{ n: 1, text: "Pregnant or breastfeeding" }],
    minAge: 18,
    maxAge: null,
    groups: ["breast"],
    facts: [],
    barriers: [],
    criteria: ITEMS,
    criteriaVersion: 1,
    ...over,
  });
  const trials = new MemoryTrialStore([server(T1), server(T2, { criteria: undefined, criteriaVersion: undefined }), server("NCT00000003", { criteriaVersion: 2 })]);
  const req = (body: unknown) =>
    new Request(`${ORIGIN}/api/match`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9" }, body: JSON.stringify(body) });
  const deps = (providers: AiProvider[]): AnalyzeDeps => ({
    env: { ENVIRONMENT: "production", DATA_VERSION: "test", DAILY_BUDGET_GROQ: "100" } as AnalyzeDeps["env"],
    store,
    trials,
    providers,
    breakerFor,
    verifyTurnstile: async (t) => t === "ok",
    salt: "salt",
    requestId: "req-1",
    log: () => undefined,
  });
  const body = (over: object = {}) => ({
    profile,
    trials: [
      { nctId: T1, criteriaVersion: 1, unknownIds: ["I2", "E2", "E9"] },
      { nctId: T2, criteriaVersion: 1, unknownIds: ["I1"] },
      { nctId: "NCT00000003", criteriaVersion: 1, unknownIds: ["I1"] },
    ],
    turnstileToken: "ok",
    ...over,
  });

  it("judges only the requested unknown ids from the server's own text; skips stale or missing criteria", async () => {
    const p = fakeProvider("groq", labelAll);
    const res = await handleMatch(req(body()), deps([p]));
    expect(res.status).toBe(200);
    const data = MatchResponseSchema.parse(await res.json());
    expect(data).toMatchObject({ status: "ok", provider: "groq", skippedIds: [T2, "NCT00000003"] });
    expect(data.results[0]?.labels.map((l) => l.id)).toEqual(["I2", "E2"]);
    const prompt = p.calls[0]?.messages[1]?.content ?? "";
    expect(prompt).toContain("Measurable disease");
    expect(prompt).not.toContain("Pregnant or breastfeeding");
  });

  it("rejects bad bodies, missing Turnstile and more than topN trials", async () => {
    expect((await handleMatch(req({ ...body(), extra: 1 }), deps([mockProvider]))).status).toBe(400);
    expect((await handleMatch(req(body({ turnstileToken: "no" })), deps([mockProvider]))).status).toBe(403);
    const tooMany = Array.from({ length: MATCH_JUDGE.topN + 1 }, (_, i) => ({ nctId: `NCT${String(i + 10).padStart(8, "0")}`, criteriaVersion: 1, unknownIds: [] }));
    expect((await handleMatch(req(body({ trials: tooMany })), deps([mockProvider]))).status).toBe(400);
    expect((await handleMatch(new Request(`${ORIGIN}/api/match`, { method: "GET", headers: { Origin: ORIGIN } }), deps([mockProvider]))).status).toBe(405);
  });

  it("returns degraded (with cached results kept) when every provider fails", async () => {
    const bad = fakeProvider("groq", () => "nope");
    const data = MatchResponseSchema.parse(await (await handleMatch(req(body()), deps([bad]))).json());
    expect(data).toMatchObject({ status: "degraded", degradedReason: "invalid_output", provider: null });
  });
});

describe("parseMatchJson top-level arrays", () => {
  const t1 = { trialId: "NCT1", items: [{ id: "I1", label: "met", reason: "r", answerIds: ["A1"] }] };
  const t2 = { trialId: "NCT2", items: [] };
  it("accepts an array of trial answers", () => {
    expect(parseMatchJson(`Here: ${JSON.stringify([t1, t2])}`).trials.map((t) => t.trialId)).toEqual(["NCT1", "NCT2"]);
  });
  it("unwraps a one-element array around the full object", () => {
    expect(parseMatchJson(JSON.stringify([{ trials: [t1] }])).trials[0]?.trialId).toBe("NCT1");
  });
  it("still accepts a plain object", () => {
    expect(parseMatchJson(JSON.stringify({ trials: [t1] })).trials).toHaveLength(1);
  });
  // Shapes from the cached gpt-oss-120b failures (data/cache/matching-llm, replayed).
  const items = t1.items;
  it("keeps trials that follow an early-closed wrapper: [{trials:[T1,T2]}, T3]", () => {
    const raw = JSON.stringify([{ trials: [t1, t2] }, { trialId: "NCT3", items }]);
    expect(parseMatchJson(raw).trials.map((t) => t.trialId)).toEqual(["NCT1", "NCT2", "NCT3"]);
  });
  it("rebuilds a trial written as loose tokens inside the trials array", () => {
    const raw = JSON.stringify({ trials: [t1, "trialId", ":", "NCT4", "items", ":", items] });
    const out = parseMatchJson(raw).trials;
    expect(out.map((t) => t.trialId)).toEqual(["NCT1", "NCT4"]);
    expect(out[1]?.items).toHaveLength(1);
  });
  it("rebuilds loose-token trials at the top level after the wrapper", () => {
    const raw = JSON.stringify([{ trials: [t1, "trialId", ":", "NCT4", "items", ":", items] }, "trialId", ":", "NCT5", "items", ":", items]);
    expect(parseMatchJson(raw).trials.map((t) => t.trialId)).toEqual(["NCT1", "NCT4", "NCT5"]);
  });
  it("drops a token run that does not name its trial id", () => {
    const raw = JSON.stringify({ trials: [t1, "trialId", ":", "items", ":", items] });
    expect(parseMatchJson(raw).trials.map((t) => t.trialId)).toEqual(["NCT1"]);
  });
  it("an empty trials list parses (the judge then re-asks: no criterion judged)", () => {
    expect(parseMatchJson(JSON.stringify({ trials: [] })).trials).toEqual([]);
  });
});
