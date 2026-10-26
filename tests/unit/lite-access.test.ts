import { describe, expect, it } from "vitest";
import { hydrateResults, liteToCard, liteToEntries } from "@/lib/match/lite";
import { rankTrials } from "@/lib/match/rank";
import { aggregateAccess } from "@/lib/access/aggregate";
import { getBarrierBreakdown, getGroupRows, getSiteTable, getStateRates, getSummary, loadAccess, pct, toCounts } from "@/lib/access/access";
import type { LiteCard } from "@/lib/types/trial";
import { AccessDataSchema } from "@/lib/types/access";
import { boston, fact, la, makeAnswers, makeCard } from "./fixtures";

const lite: LiteCard = { id: "NCT00000001", title: "T", conditions: ["Breast Cancer"], groups: ["breast"], minAge: 18, maxAge: null, f: [["pregnancy", "excluded"]], b: ["english_required"] };

describe("lite cross-group index", () => {
  it("expands lite cards for ranking and hydrates top results with full cards", () => {
    expect(liteToCard(lite).facts[0]).toMatchObject({ key: "pregnancy", value: "excluded" });
    const entries = liteToEntries({ cards: [lite], sites: { NCT00000001: [[42.34, -71.1]] }, embeddings: Int8Array.from([1, 0]) }, 2);
    const answers = makeAnswers({ cancerType: "other", pregnant: "yes", language: "es" });
    const origin = { lat: 42.36, lon: -71.06 };
    const outcome = rankTrials({ entries, answers, origin, keywordSearch: () => ["NCT00000001"], queryVector: [1, 0] });
    expect(outcome.results).toHaveLength(1);
    const fullCard = makeCard({ facts: [fact("pregnancy", "excluded", "exclusion")], barriers: [{ type: "english_required", quote: "Speak English" }] });
    const hydrated = hydrateResults(outcome, new Map([["NCT00000001", { card: fullCard, sites: [boston, la] }]]), answers, origin);
    const r = hydrated.results[0];
    expect(r?.card.inclusion.length).toBeGreaterThan(0);
    expect(r?.nearest?.site.facility).toBe("Boston site");
    expect(r?.precheck[0]?.quote).toBe("pregnancy quote");
    expect(r?.languageWarning).toBe(true);
    expect(hydrateResults(outcome, new Map(), answers, origin).results).toEqual([]);
  });
});

describe("access intelligence", () => {
  const a = makeCard({ id: "NCT00000001", groups: ["breast"], barriers: [{ type: "english_required", quote: "q" }] });
  const b = makeCard({ id: "NCT00000002", groups: ["lung", "solid-tumors"], barriers: [] });
  const c = makeCard({ id: "NCT00000003", groups: ["breast"], barriers: [{ type: "upper_age_limit", quote: "q" }, { type: "disability_exclusion", quote: "q" }] });
  const cards = [a, b, c, makeCard({ id: "NCT00000004" }), makeCard({ id: "NCT00000005" })];
  const sites = new Map(cards.map((x) => [x.id, x.id === "NCT00000002" ? [la] : [boston, { ...boston, facility: "Boston site (Site 0012)" }]]));
  const data = AccessDataSchema.parse(aggregateAccess(cards, sites, "2026-10-06", "v1"));

  it("aggregates totals, groups, states, and sites with 5+ trials", () => {
    expect(data.totals).toEqual([5, 2, 1, 1, 1]);
    expect(data.byGroup.breast).toEqual([4, 2, 1, 1, 1]);
    expect(data.byState.MA?.[0]).toBe(4);
    expect(data.byState.CA?.[0]).toBe(1);
    expect(data.byStateGroup.CA?.lung).toEqual([1, 0, 0, 0, 0]);
    expect(data.sites).toHaveLength(0); // Boston site has 4 trials (site-number variants merged), below 5
    const more = aggregateAccess([...cards, makeCard({ id: "NCT00000006" })], new Map([...sites, ["NCT00000006", [boston]]]), "d", "v");
    expect(more.sites[0]).toMatchObject({ facility: "Boston site", state: "MA", counts: [5, 2, 1, 1, 1] });
  });

  it("helpers compute filtered summaries, rates, and tables", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(1, 0)).toBe(0);
    expect(toCounts(undefined).trials).toBe(0);
    expect(getSummary(data).trials).toBe(5);
    expect(getSummary(data, { state: "MA" }).anyBarrier).toBe(2);
    expect(getSummary(data, { group: "lung" }).trials).toBe(1);
    expect(getSummary(data, { state: "MA", group: "breast" }).english_required).toBe(1);
    expect(getStateRates(data).find((r) => r.state === "MA")).toEqual({ state: "MA", trials: 4, count: 2, rate: 50 });
    expect(getStateRates(data, { group: "lung", metric: "english_required" })).toEqual([{ state: "CA", trials: 1, count: 0, rate: 0 }]);
    expect(getBarrierBreakdown(data).map((r) => r.count)).toEqual([2, 1, 1, 1]);
    expect(getGroupRows(data)[0]?.group).toBe("breast");
    expect(getGroupRows(data, "CA").map((r) => r.group).sort()).toEqual(["lung", "solid-tumors"]);
    const more = AccessDataSchema.parse(aggregateAccess([...cards, makeCard({ id: "NCT00000006" })], new Map([...sites, ["NCT00000006", [boston]]]), "d", "v"));
    expect(getSiteTable(more)[0]).toMatchObject({ facility: "Boston site", trials: 5, rate: 40 });
    expect(getSiteTable(more, { state: "CA" })).toEqual([]);
    expect(getSiteTable(more, { group: "breast", minTrials: 1, metric: "english_required" })[0]?.rate).toBe(20);
  });

  it("loadAccess validates and memoizes", async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify(data));
    }) as unknown as typeof fetch;
    expect((await loadAccess(f)).totals[0]).toBe(5);
    await loadAccess(f);
    expect(calls).toBe(1);
  });
});
