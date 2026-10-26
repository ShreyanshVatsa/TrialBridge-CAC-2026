import { describe, expect, it } from "vitest";
import { getCatalog } from "@/config/questionnaire";
import { mergeLabels, trialMatchScore, tierOrder, isHardFailure } from "@/lib/match/score";
import { orderResults, rankByCriteria } from "@/lib/match/rank";
import { findOutPriority, isRealProvider, judgeRequests, prioritizeFindOut, rankWithCriteria, rankingFromJudge, resolveRanking, resolverLabels } from "@/lib/match/criteria-rank";
import type { CriterionLabel, TrialCriteriaLabels } from "@/lib/types/criteria";
import type { MatchResponse } from "@/lib/types/match-judge";
import type { QuestionnaireState } from "@/lib/types/questionnaire";
import type { SplitCriterion } from "@/lib/ingest/criteria-split";
import { makeAnswers, makeCard } from "./fixtures";

const L = (id: string, label: CriterionLabel["label"], source: CriterionLabel["source"] = "rule"): CriterionLabel => ({ id, section: id.startsWith("I") ? "inclusion" : "exclusion", label, source });

describe("trialMatchScore", () => {
  it("incScore = met / (met + not_met + unknown) over inclusion items; not_applicable is left out", () => {
    const s = trialMatchScore("NCT1", [L("I1", "met"), L("I2", "met"), L("I3", "unknown"), L("I4", "not_applicable"), L("E1", "unknown"), L("E2", "not_excluded")], 3, false);
    expect(s.incScore).toBeCloseTo(2 / 3, 6);
    expect(s.tier).toBe("A");
    expect(s.hardFailures).toEqual([]);
    expect(s.counts).toEqual({ met: 2, notMet: 0, excluded: 0, notExcluded: 1, unknown: 2, notApplicable: 1 });
    expect(s.retrievalRank).toBe(3);
    expect(s.degraded).toBe(false);
  });

  it("an inclusion not_met or an exclusion excluded puts the trial in tier B with the failing criteria", () => {
    const a = trialMatchScore("NCT1", [L("I1", "not_met"), L("E1", "not_excluded")], 1, false);
    const b = trialMatchScore("NCT2", [L("I1", "met"), L("E1", "excluded")], 1, false);
    expect(a.tier).toBe("B");
    expect(a.hardFailures.map((l) => l.id)).toEqual(["I1"]);
    expect(b.tier).toBe("B");
    expect(b.hardFailures.map((l) => l.id)).toEqual(["E1"]);
  });

  it("unknowns never lower the tier, however many there are", () => {
    const labels = Array.from({ length: 40 }, (_, i) => L(i % 2 ? `E${i + 1}` : `I${i + 1}`, "unknown", "default"));
    expect(trialMatchScore("NCT1", labels, 1, true).tier).toBe("A");
    expect(isHardFailure(L("I1", "unknown"))).toBe(false);
    expect(isHardFailure(L("E1", "unknown"))).toBe(false);
  });

  it("no labels at all: incScore 0, tier A, finite", () => {
    const s = trialMatchScore("NCT1", [], 1, false);
    expect(s.incScore).toBe(0);
    expect(s.tier).toBe("A");
  });
});

describe("tierOrder", () => {
  it("tier A by incScore then retrieval rank, tier B below", () => {
    const mk = (trialId: string, tier: "A" | "B", incScore: number, retrievalRank: number) => ({ trialId, tier, incScore, retrievalRank });
    const out = tierOrder([mk("b1", "B", 1, 1), mk("a1", "A", 0.5, 4), mk("a2", "A", 0.9, 5), mk("a3", "A", 0.5, 2), mk("b2", "B", 0.2, 3)]);
    expect(out.map((s) => s.trialId)).toEqual(["a2", "a3", "a1", "b1", "b2"]);
  });
});

describe("mergeLabels", () => {
  it("the LLM only fills ids the resolver left unknown", () => {
    const resolver = [L("I1", "met"), L("I2", "unknown", "default"), L("E1", "not_excluded"), L("E2", "unknown", "default")];
    const llm: CriterionLabel[] = [
      { ...L("I1", "not_met", "llm"), reason: "tries to override" },
      { ...L("I2", "met", "llm"), reason: "You said X.", answerIds: ["A2"] },
      L("E1", "excluded", "llm"),
      L("E2", "excluded", "llm"),
      L("I9", "met", "llm"),
    ];
    const out = mergeLabels(resolver, llm);
    expect(out.map((l) => [l.id, l.label, l.source])).toEqual([
      ["I1", "met", "rule"],
      ["I2", "met", "llm"],
      ["E1", "not_excluded", "rule"],
      ["E2", "excluded", "llm"],
    ]);
    expect(out[1]).toMatchObject({ reason: "You said X.", answerIds: ["A2"] });
  });

  it("ignores LLM labels that do not fit the item's section", () => {
    const out = mergeLabels([L("I1", "unknown", "default"), L("E1", "unknown", "default")], [L("I1", "excluded", "llm"), { ...L("E1", "met", "llm"), section: "exclusion" }]);
    expect(out.map((l) => l.label)).toEqual(["unknown", "unknown"]);
  });

  it("no LLM labels: a copy of the resolver labels", () => {
    const r = [L("I1", "met")];
    const out = mergeLabels(r, null);
    expect(out).toEqual(r);
    expect(out[0]).not.toBe(r[0]);
  });
});

describe("rankByCriteria / orderResults", () => {
  const cards = [makeCard({ id: "NCT00000001", criteriaVersion: 1 }), makeCard({ id: "NCT00000002", criteriaVersion: 1 }), makeCard({ id: "NCT00000003", criteriaVersion: 1 })];
  const results = cards.map((card) => ({ card }));
  const resolver = new Map<string, CriterionLabel[]>([
    ["NCT00000001", [L("I1", "met"), L("I2", "unknown", "default")]],
    ["NCT00000002", [L("I1", "met"), L("I2", "met")]],
    ["NCT00000003", [L("I1", "not_met"), L("I2", "met")]],
  ]);
  const judged: TrialCriteriaLabels = { trialId: "NCT00000001", criteriaVersion: 1, provider: "groq", labels: [L("I2", "met", "llm")] };

  it("resolver-only: tier A by incScore, tier B last, unknown-bearing trials degraded", () => {
    const { order, byTrial } = rankByCriteria(results, resolver, null);
    expect(order).toEqual(["NCT00000002", "NCT00000001", "NCT00000003"]);
    expect(byTrial["NCT00000001"]?.score.degraded).toBe(true);
    expect(byTrial["NCT00000002"]?.score.degraded).toBe(false);
    expect(byTrial["NCT00000003"]?.score.hardFailures.map((l) => l.id)).toEqual(["I1"]);
  });

  it("real LLM labels fill the unknowns; ties then fall back to retrieval rank", () => {
    const { order, byTrial } = rankByCriteria(results, resolver, { results: [judged], real: true });
    expect(order).toEqual(["NCT00000001", "NCT00000002", "NCT00000003"]);
    expect(byTrial["NCT00000001"]?.score.degraded).toBe(false);
    expect(byTrial["NCT00000001"]?.labels[1]?.source).toBe("llm");
  });

  it("with a real judge, a trial it never saw goes after the trials it checked, even with a higher incScore", () => {
    const unseen = { card: { id: "NCT00000004", criteriaVersion: 1 } };
    const r = new Map(resolver).set("NCT00000004", [L("I1", "met"), L("I2", "met"), L("I3", "unknown", "default")]);
    const partial: TrialCriteriaLabels = { ...judged, labels: [L("I2", "unknown", "llm")] };
    expect(rankByCriteria([...results, unseen], r, { results: [partial], real: true }).order).toEqual(["NCT00000002", "NCT00000001", "NCT00000004", "NCT00000003"]);
    // Without a real judge the order is the plain tier / incScore order.
    expect(rankByCriteria([...results, unseen], r, null).order).toEqual(["NCT00000002", "NCT00000004", "NCT00000001", "NCT00000003"]);
  });

  it("mock labels and a stale criteriaVersion are ignored", () => {
    expect(rankByCriteria(results, resolver, { results: [judged], real: false }).byTrial["NCT00000001"]?.labels[1]?.label).toBe("unknown");
    expect(rankByCriteria(results, resolver, { results: [{ ...judged, criteriaVersion: 2 }], real: true }).byTrial["NCT00000001"]?.labels[1]?.label).toBe("unknown");
  });

  it("orderResults follows the order; ids missing from it go last in their own order", () => {
    expect(orderResults(results, ["NCT00000003", "NCT00000001"]).map((r) => r.card.id)).toEqual(["NCT00000003", "NCT00000001", "NCT00000002"]);
  });
});

// ---------------------------------------------------------------------------------------------
// End to end over the real resolver and catalog.

const items: SplitCriterion[] = [
  { id: "I1", section: "inclusion", text: "Age 18 years or older" },
  { id: "I2", section: "inclusion", text: "ECOG performance status 0-1" },
  { id: "I3", section: "inclusion", text: "Adequate organ function" },
  { id: "E1", section: "exclusion", text: "Uncontrolled hypertension" },
];
const state = (answers: QuestionnaireState["answers"], deferred: string[] = []): QuestionnaireState => ({
  v: 2,
  area: "cancer",
  mode: "thorough",
  answers: { cancer_type: "lung", age: 60, zip: "10001", travel: "100", ...answers },
  history: [],
  deferred,
  updatedAt: 0,
});
const catalog = getCatalog("cancer", "lung");
const trial = (id: string, criteria: SplitCriterion[] = items) => ({ card: makeCard({ id, groups: ["lung"], criteria, criteriaVersion: 1 }) });
const answersOf = (s: QuestionnaireState) => makeAnswers({ cancerType: "lung", questionnaire: s });
const okResponse = (provider: string, results: TrialCriteriaLabels[]): MatchResponse => ({ status: "ok", provider, results, cachedIds: [], skippedIds: [] });

describe("resolver-backed ranking", () => {
  it("'don't know', skip and deferred give the same labels, scores and order as not answering", () => {
    const results = [trial("NCT00000011"), trial("NCT00000012", [items[0] as SplitCriterion])];
    const sig = (s: QuestionnaireState) => {
      const r = resolveRanking(results, answersOf(s), catalog);
      return { order: r.order, byTrial: r.byTrial };
    };
    const want = sig(state({}));
    expect(sig(state({ daily_activity: "unknown" }))).toEqual(want);
    expect(sig(state({ daily_activity: "__skip" }))).toEqual(want);
    expect(sig(state({ daily_activity: null }, ["daily_activity"]))).toEqual(want);
  });

  it("a failing answer moves the trial to tier B with the failing item as the reason", () => {
    const results = [trial("NCT00000011"), trial("NCT00000012")];
    const ok = resolveRanking(results, answersOf(state({ daily_activity: "0-1" })), catalog);
    expect(ok.byTrial["NCT00000011"]?.score.tier).toBe("A");
    const bad = resolveRanking(results, answersOf(state({ daily_activity: "3-4" })), catalog);
    expect(bad.byTrial["NCT00000011"]?.score.tier).toBe("B");
    expect(bad.byTrial["NCT00000011"]?.score.hardFailures[0]).toMatchObject({ id: "I2", label: "not_met", source: "rule" });
  });

  it("resolveRanking is pending and degraded while unknown items wait for the judge", () => {
    const r = resolveRanking([trial("NCT00000011")], answersOf(state({})), catalog);
    expect(r).toMatchObject({ status: "pending", degraded: true, provider: null });
    expect(resolveRanking([trial("NCT00000011", [items[0] as SplitCriterion])], answersOf(state({})), catalog)).toMatchObject({ status: "ok", degraded: false });
  });

  it("judge requests: top N with split criteria and unknown items only", () => {
    const results = [trial("NCT00000011"), trial("NCT00000012", [items[0] as SplitCriterion]), { card: makeCard({ id: "NCT00000013" }) }, trial("NCT00000014")];
    const resolver = resolverLabels(results, answersOf(state({})), catalog);
    const req = judgeRequests(results, resolver, 3);
    expect(req.map((r) => r.nctId)).toEqual(["NCT00000011"]);
    // I3 "Adequate organ function" is checked at screening (lib/match/screening.ts) and is not sent to the judge.
    expect(req[0]?.unknownIds).toEqual(["I2", "E1"]);
  });

  it("unknown items feed the Find-out list priority (questions answered 'not sure')", () => {
    const results = [trial("NCT00000011"), trial("NCT00000012")];
    const a = answersOf(state({ daily_activity: "unknown" }));
    const r = resolveRanking(results, a, catalog);
    expect(r.findOutPriority["daily_activity"]).toBe(2);
    expect(findOutPriority(results, r.byTrial, answersOf(state({})), catalog)).toEqual({});
    const entries = [{ question: "brain_mets" }, { question: "daily_activity" }];
    expect(prioritizeFindOut(entries, r.findOutPriority).map((e) => e.question)).toEqual(["daily_activity", "brain_mets"]);
  });
});

describe("rankWithCriteria (degraded mode and provider logging)", () => {
  const results = [trial("NCT00000011"), trial("NCT00000012")];
  const a = answersOf(state({}));
  const llm = (trialId: string): TrialCriteriaLabels => ({ trialId, criteriaVersion: 1, provider: "groq", labels: [L("I2", "met", "llm"), L("I3", "met", "llm"), L("E1", "not_excluded", "llm")] });

  it("real provider: merged labels, not degraded, provider logged, results reordered", async () => {
    const logs: unknown[] = [];
    const out = await rankWithCriteria(results, a, { catalog, judge: async () => okResponse("groq", [llm("NCT00000012")]), log: (e) => logs.push(e) });
    expect(out.ranking).toMatchObject({ status: "ok", degraded: false, provider: "groq" });
    expect(out.ranking.order).toEqual(["NCT00000012", "NCT00000011"]);
    expect(out.results.map((r) => r.card.id)).toEqual(["NCT00000012", "NCT00000011"]);
    expect(out.ranking.byTrial["NCT00000012"]?.score.incScore).toBeCloseTo(1, 6);
    expect(out.ranking.byTrial["NCT00000011"]?.score.degraded).toBe(true);
    expect(logs).toEqual([{ provider: "groq", status: "ok", judged: 2 }]);
  });

  it("mock provider, degraded response or a throwing judge: resolver-only and degraded", async () => {
    for (const judge of [
      async () => okResponse("mock", [llm("NCT00000012")]),
      async (): Promise<MatchResponse> => ({ status: "degraded", provider: null, results: [], cachedIds: [], skippedIds: [], degradedReason: "budget_exhausted" }),
      async (): Promise<MatchResponse> => {
        throw new Error("network");
      },
    ]) {
      const logs: { provider: string | null }[] = [];
      const out = await rankWithCriteria(results, a, { catalog, judge, log: (e) => logs.push(e) });
      expect(out.ranking.degraded).toBe(true);
      expect(out.ranking.status).toBe("degraded");
      expect(out.ranking.byTrial["NCT00000012"]?.labels.every((l) => l.source !== "llm")).toBe(true);
      expect(out.ranking.order).toEqual(["NCT00000011", "NCT00000012"]);
      expect(logs[0]?.provider === null || logs[0]?.provider === "mock").toBe(true);
    }
  });

  it("nothing unknown: no judge call, not degraded", async () => {
    let called = false;
    const out = await rankWithCriteria([trial("NCT00000011", [items[0] as SplitCriterion])], a, {
      catalog,
      judge: async () => {
        called = true;
        return okResponse("groq", []);
      },
    });
    expect(called).toBe(false);
    expect(out.ranking).toMatchObject({ status: "ok", degraded: false, provider: null });
  });

  it("an aborted search rethrows", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(rankWithCriteria(results, a, { catalog, signal: ac.signal, judge: async () => Promise.reject(new Error("aborted")) })).rejects.toThrow("aborted");
  });

  it("rankingFromJudge(null) and isRealProvider", () => {
    const resolver = resolverLabels(results, a, catalog);
    expect(rankingFromJudge(results, resolver, null, a, catalog)).toMatchObject({ status: "ok", degraded: false });
    expect([isRealProvider("groq"), isRealProvider("mock"), isRealProvider(null)]).toEqual([true, false, false]);
  });
});
