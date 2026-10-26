import { beforeEach, describe, expect, it, vi } from "vitest";
import MiniSearch from "minisearch";
import { setFetchForTests } from "@/lib/data/loader";
import { MINISEARCH_OPTIONS, toSearchDoc } from "@/lib/match/minisearch-config";
import { rankTrials, sexFilter, trialPrecheck, type RankEntry } from "@/lib/match/rank";
import { buildProfileText } from "@/lib/match/query";
import { passesSex } from "@/lib/match/filters";
import { hydrateResults } from "@/lib/match/lite";
import { applyAnalysis } from "@/lib/match/apply";
import { BIOMARKER_MATCH_BONUS, finalScore, phaseBonus, PHASE_PREF_BONUS, precheckBonus, precheckPenalty, CONFLICT_PENALTY, SPECIFIC_REQUIREMENT_WEIGHT, LOW_CERTAINTY_FACT_WEIGHT, MAX_COUNTED_CONFLICTS } from "@/lib/match/score";
import { evaluateAnswers } from "@/lib/match/precheck";
import { buildCandidatePool, liveCount, poolFromEntries, toIntakeAnswers } from "@/lib/questionnaire/engine";
import { legacyBiomarkers, legacySpread, legacyTreatments, travelMiles } from "@/lib/questionnaire/adapter";
import type { Manifest, TrialCard } from "@/lib/types/trial";
import type { AnswerValue, QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import type { PrecheckNote } from "@/lib/types/match";
import { boston, la, makeCard } from "./fixtures";
import { essentials, makePool, pick, rng, TEST_CATALOG } from "./qn-fixtures";

vi.mock("@/lib/match/embedder", () => ({ embedProfile: vi.fn(async () => Float32Array.from([1, 0])) }));
import { searchTrials } from "@/lib/match/search";

const origin = { lat: 42.36, lon: -71.06 };
const lungCard = (id: string, over: Partial<TrialCard> = {}) => makeCard({ id, groups: ["lung"], conditions: ["Lung Cancer"], title: `Lung study ${id}`, ...over });

describe("score weights (v2)", () => {
  const n = (over: Partial<PrecheckNote>): PrecheckNote => ({ key: "metastatic", kind: "conflict", quote: "q", ref: { section: "inclusion", n: 1 }, ...over });
  it("weights conflicts by fact key and source, capped at the largest four", () => {
    expect(precheckPenalty([n({ key: "biomarker:EGFR", value: "required" })])).toBeCloseTo(CONFLICT_PENALTY * SPECIFIC_REQUIREMENT_WEIGHT, 12);
    expect(precheckPenalty([n({ key: "histology:sclc", value: "required" })])).toBeCloseTo(CONFLICT_PENALTY * SPECIFIC_REQUIREMENT_WEIGHT, 12);
    expect(precheckPenalty([n({ key: "biomarker:EGFR", value: "excluded" })])).toBeCloseTo(CONFLICT_PENALTY, 12);
    expect(precheckPenalty([n({ key: "other_malignancy" })])).toBeCloseTo(CONFLICT_PENALTY * LOW_CERTAINTY_FACT_WEIGHT, 12);
    expect(precheckPenalty([n({ source: "llm", confidence: 0.5 })])).toBeCloseTo(CONFLICT_PENALTY * 0.5, 12);
    expect(precheckPenalty([n({ source: "llm" })])).toBeCloseTo(CONFLICT_PENALTY, 12);
    const many = [n({ key: "other_malignancy" }), ...Array.from({ length: 4 }, () => n({ key: "histology:x" as never, value: "required" }))];
    expect(precheckPenalty(many)).toBeCloseTo(MAX_COUNTED_CONFLICTS * CONFLICT_PENALTY * SPECIFIC_REQUIREMENT_WEIGHT, 12);
  });
  it("adds the biomarker match bonus once, and the phase preference", () => {
    const sup = n({ key: "biomarker:EGFR", kind: "support", value: "required" });
    expect(precheckBonus([sup, { ...sup, key: "biomarker:ALK" }])).toBeCloseTo(0.06 + BIOMARKER_MATCH_BONUS, 12);
    expect(precheckBonus([{ ...sup, value: "excluded" }])).toBeCloseTo(0.03, 12);
    expect(phaseBonus("open_phase1", ["PHASE1"])).toBe(PHASE_PREF_BONUS);
    expect(phaseBonus("open_phase1", ["PHASE2"])).toBe(0);
    expect(phaseBonus("later_phase", ["EARLY_PHASE1"])).toBe(-PHASE_PREF_BONUS);
    expect(phaseBonus("later_phase", ["PHASE2", "PHASE3"])).toBe(PHASE_PREF_BONUS);
    expect(phaseBonus("later_phase", ["PHASE2"])).toBe(0);
    expect(phaseBonus("later_phase", [])).toBe(0);
    expect(phaseBonus("unknown", ["PHASE1"])).toBe(0);
    expect(phaseBonus(null, ["PHASE1"])).toBe(0);
    expect(finalScore({ retrieval: 0.5, precheck: [], fit: null, phase: 0.03 })).toBeCloseTo(0.53, 12);
  });
});

describe("adapter: questionnaire state -> v1 IntakeAnswers", () => {
  it("maps the essentials and coarse legacy fields, and carries the state", () => {
    const s = essentials("lung", { spread: "metastatic", treatments: ["chemotherapy", "hormone_therapy"], biomarkers: { EGFR: "positive", ALK: "not_tested", MET: "positive" }, pregnancy: "unknown", in_other_trial: "yes" });
    const a = toIntakeAnswers(s, "es");
    expect(a).toMatchObject({ cancerType: "lung", zip: "10001", travelMiles: 100, age: 60, language: "es", spread: "yes", treatments: ["chemotherapy"], biomarkers: { EGFR: "positive", ALK: "dont_know" }, pregnant: "not_sure", inAnotherTrial: "yes" });
    expect(a.questionnaire).toBe(s);
    expect(() => toIntakeAnswers({ ...s, answers: { cancer_type: "lung" } })).toThrow();
  });
  it("maps non-responses to the v1 'not sure' values", () => {
    expect(legacySpread("early")).toBe("no");
    expect(legacySpread("__skip")).toBe("not_sure");
    expect(legacySpread(undefined)).toBe("not_sure");
    expect(legacyTreatments(["unknown"])).toEqual(["not_sure"]);
    expect(legacyTreatments(["hormone_therapy"])).toEqual(["not_sure"]);
    expect(legacyTreatments(["none"])).toEqual(["none"]);
    expect(legacyTreatments("x")).toEqual(["not_sure"]);
    expect(travelMiles("anywhere")).toBeNull();
    expect(travelMiles(null)).toBeNull();
    expect(travelMiles("250")).toBe(250);
    expect(legacyBiomarkers(essentials("lung", { biomarkers: ["x"], deep_biomarkers: { BRCA: "negative" } }))).toEqual({ BRCA: "negative" });
    expect(toIntakeAnswers(essentials("lung", { pregnancy: "prefer_not", in_other_trial: "unknown" })).inAnotherTrial).toBe("no");
  });
});

describe("matching integration (rankTrials with a questionnaire)", () => {
  const entries: RankEntry[] = [
    { card: lungCard("NCT00000001", { sex: "FEMALE" }), sites: [boston], vector: [1, 0] },
    { card: lungCard("NCT00000002", { sex: "MALE" }), sites: [boston], vector: [1, 0] },
    { card: lungCard("NCT00000003", { facts: [{ key: "ecog_max", value: "required", param: 1, quote: "ECOG 0-1", ref: { section: "inclusion", n: 2 }, source: "rule" }] }), sites: [boston], vector: [1, 0] },
    { card: lungCard("NCT00000004", { phases: ["PHASE1"] }), sites: [boston], vector: [1, 0] },
    { card: lungCard("NCT00000005"), sites: [la], vector: [1, 0] },
  ];
  const run = (s: QuestionnaireState, catalog: readonly QuestionDef[] | undefined = TEST_CATALOG) =>
    rankTrials({ entries, answers: toIntakeAnswers(s), origin, keywordSearch: (ids) => [...ids].sort(), queryVector: [1, 0], ...(catalog ? { catalog } : {}) });

  it("a definite sex is a hard filter; prefer not / unknown never filters", () => {
    expect(run(essentials("lung", { sex: "female" })).results.map((r) => r.card.id)).not.toContain("NCT00000002");
    expect(run(essentials("lung", { sex: "male" })).results.map((r) => r.card.id)).not.toContain("NCT00000001");
    for (const v of ["prefer_not", "unknown", "__skip"]) expect(run(essentials("lung", { sex: v })).candidateCount).toBe(4);
    expect(passesSex({ sex: "ALL" }, "MALE")).toBe(true);
    expect(sexFilter(toIntakeAnswers(essentials("lung", { sex: "female" })))).toBeNull(); // no catalog => no v2 semantics
  });

  it("uses catalog notes (ECOG) and the phase preference", () => {
    const out = run(essentials("lung", { daily_activity: "3-4", phase_pref: "open_phase1" }));
    const t3 = out.results.find((r) => r.card.id === "NCT00000003")!;
    expect(t3.precheck.map((n) => `${n.key}:${n.kind}`)).toEqual(["ecog_max:conflict"]);
    const t4 = out.results.find((r) => r.card.id === "NCT00000004")!;
    expect(t4.scores.phaseBonus).toBe(PHASE_PREF_BONUS);
    expect(t4.scores.final).toBeCloseTo(t4.scores.retrieval + PHASE_PREF_BONUS, 12);
    // AI re-ranking keeps the phase bonus (and treats a missing one as 0).
    const noPhase = { ...t4, scores: { ...t4.scores, phaseBonus: undefined } };
    expect(applyAnalysis([noPhase], { status: "degraded", provider: null, results: [], experimental: false, cached: false })[0]!.scores.final).toBeCloseTo(t4.scores.retrieval, 12);
    const re = applyAnalysis(out.results, { status: "degraded", provider: null, results: [], experimental: false, cached: false });
    expect(re.find((r) => r.card.id === "NCT00000004")!.scores.final).toBeCloseTo(t4.scores.final, 12);
  });

  it("without a catalog the v1 pre-check is used", () => {
    const { notes, phase } = trialPrecheck(toIntakeAnswers(essentials("lung", { spread: "metastatic" })), { facts: [{ key: "metastatic", value: "excluded", quote: "q", ref: { section: "exclusion", n: 1 }, source: "rule" }], phases: [] });
    expect(notes.map((n) => n.kind)).toEqual(["conflict"]);
    expect(phase).toBe(0);
  });

  it("hydrates lite results with the questionnaire context", () => {
    const out = run(essentials("lung", { daily_activity: "3-4" }));
    const full = new Map(entries.map((e) => [e.card.id, { card: e.card, sites: e.sites }]));
    const h = hydrateResults(out, full, toIntakeAnswers(essentials("lung", { daily_activity: "3-4" })), origin, { catalog: TEST_CATALOG });
    expect(h.results.find((r) => r.card.id === "NCT00000003")!.precheck[0]?.kind).toBe("conflict");
  });

  it("profile text is the chosen options' query terms in catalog order; unknown adds nothing", () => {
    const a = toIntakeAnswers(essentials("lung", { biomarkers: { EGFR: "positive" }, subtype: "nsclc_adeno", spread: "unknown" }));
    expect(buildProfileText(a, TEST_CATALOG)).toBe("Lung cancer. Non-small cell lung adenocarcinoma. EGFR positive.");
    expect(buildProfileText({ ...a, cancerType: "other" }, TEST_CATALOG).startsWith("Cancer.")).toBe(true);
  });
});

/** Random answers for every non-essential catalog question (each answered with probability 1/2). */
function randomState(r: () => number, group: "lung" | "breast" = "lung"): QuestionnaireState {
  const extra: Record<string, AnswerValue> = {};
  for (const q of TEST_CATALOG) {
    if (q.tier === "essential" || r() < 0.5) continue;
    const ids = (q.options ?? []).map((o) => o.id);
    if (q.type === "single") extra[q.id] = pick(r, ids);
    else if (q.type === "multi") extra[q.id] = ids.filter(() => r() < 0.3);
    else if (q.type === "biomarker_grid") extra[q.id] = Object.fromEntries((q.biomarkers ?? []).filter(() => r() < 0.6).map((b) => [b, pick(r, ["positive", "negative", "not_tested", "unknown"])]));
  }
  return essentials(group, extra);
}

describe("non-response invariants (seeded property test, 1,000 random states)", { timeout: 120_000 }, () => {
  const pool = makePool(11, 80);
  const entries: RankEntry[] = pool.trials.map((t, i) => ({
    card: lungCard(t.id, { sex: t.sex, phases: [pick(rng(i), ["PHASE1", "PHASE2", "PHASE3"])], facts: t.facts.map((f) => ({ ...f, quote: f.key, ref: { section: "inclusion" as const, n: 1 }, source: "rule" as const })) }),
    sites: [i % 9 === 0 ? la : boston],
    vector: [Math.cos(i), Math.sin(i)],
  }));
  const rank = (s: QuestionnaireState) =>
    rankTrials({ entries, answers: toIntakeAnswers(s), origin, keywordSearch: (ids) => [...ids].sort().reverse(), queryVector: [1, 0], catalog: TEST_CATALOG, limit: 1000 });
  const signature = (s: QuestionnaireState) => ({
    ranked: rank(s).results.map((x) => [x.card.id, x.scores.final, x.precheck.map((n) => n.kind).join()]),
    count: liveCount(s, pool, TEST_CATALOG),
    notes: entries.map((e) => evaluateAnswers(s, TEST_CATALOG, e.card.facts).length),
  });

  it("unknown, skip, prefer not and deferred are identical to not answering: same filters, scores, ranks, counters", () => {
    const r = rng(2026);
    const askable = TEST_CATALOG.filter((q) => q.tier !== "essential" && q.type !== "biomarker_grid" && q.type !== "multi");
    for (let i = 0; i < 1000; i++) {
      const base = randomState(r);
      const q = pick(r, askable);
      const without = { ...base, answers: Object.fromEntries(Object.entries(base.answers).filter(([k]) => k !== q.id)) };
      // Dependents of q stay as they are in both states, so only q's own answer differs.
      const want = signature(without);
      const variants: QuestionnaireState[] = [
        { ...without, answers: { ...without.answers, [q.id]: "unknown" } },
        { ...without, answers: { ...without.answers, [q.id]: "__skip" } },
        { ...without, answers: { ...without.answers, [q.id]: "prefer_not" } },
        { ...without, answers: { ...without.answers, [q.id]: null }, deferred: [q.id] },
      ];
      for (const v of variants) {
        // Prerequisites that read "unknown" may switch a dependent on or off; compare only when they don't.
        const dependents = TEST_CATALOG.filter((d) => d.prerequisites?.some((p) => p.question === q.id)).map((d) => d.id as string);
        if (dependents.some((d) => base.answers[d] !== undefined)) continue;
        expect(signature(v), `q=${q.id} value=${JSON.stringify(v.answers[q.id])}`).toEqual(want);
      }
    }
  });

  it("multi-select and grid non-responses are identical to not answering", () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const base = randomState(r);
      for (const [qid, unknowns] of [
        ["treatments", [["unknown"], []]],
        ["biomarkers", [{ EGFR: "unknown", ALK: "not_tested" }, {}, { HER2: "__skip" }]],
      ] as const) {
        const without = { ...base, answers: Object.fromEntries(Object.entries(base.answers).filter(([k]) => k !== qid && k !== "lines")) };
        const want = signature(without);
        for (const u of unknowns) expect(signature({ ...without, answers: { ...without.answers, [qid]: u as AnswerValue } })).toEqual(want);
      }
    }
  });

  it("a definite answer never changes the counter's `total` except through the sex hard filter", () => {
    const r = rng(99);
    for (let i = 0; i < 200; i++) {
      const s = randomState(r);
      const noSex = { ...s, answers: Object.fromEntries(Object.entries(s.answers).filter(([k]) => k !== "sex")) };
      expect(liveCount(noSex, pool, TEST_CATALOG).total).toBe(pool.trials.length);
    }
  });
});

describe("candidate pool", () => {
  it("applies group/age/distance hard filters and normalizes the BM25 prior", () => {
    const entries = [
      { card: lungCard("NCT00000001"), sites: [boston] },
      { card: lungCard("NCT00000001"), sites: [boston] }, // duplicate across shard parts
      { card: lungCard("NCT00000002", { maxAge: 40 }), sites: [boston] },
      { card: lungCard("NCT00000003"), sites: [la] },
      { card: makeCard({ id: "NCT00000004" }), sites: [boston] },
      { card: lungCard("NCT00000005", { sex: "FEMALE" }), sites: [boston] },
    ];
    const pool = poolFromEntries({ entries, state: essentials("lung"), origin, bm25: () => new Map([["NCT00000001", 4], ["NCT00000005", 2]]) });
    expect(pool.trials.map((t) => [t.id, t.prior, t.sex])).toEqual([
      ["NCT00000001", 1, "ALL"],
      ["NCT00000005", 0.5, "FEMALE"],
    ]);
    const anywhere = poolFromEntries({ entries, state: essentials("lung", { travel: "anywhere" }), origin, bm25: () => new Map() });
    expect(anywhere.trials.map((t) => [t.id, t.prior])).toEqual([
      ["NCT00000001", 0],
      ["NCT00000003", 0],
      ["NCT00000005", 0],
    ]);
    expect(() => poolFromEntries({ entries, state: { ...essentials(), answers: {} }, origin, bm25: () => new Map() })).toThrow();
  });

  it("buildCandidatePool loads the group's shard (full or lite) and ZIP, BM25 only", async () => {
    const V = "/data/shards/pool";
    const cards = [lungCard("NCT00000011", { title: "EGFR lung adenocarcinoma" }), lungCard("NCT00000012", { title: "Lung cancer exercise", sex: "MALE" })];
    const index = new MiniSearch(MINISEARCH_OPTIONS);
    index.addAll(cards.map(toSearchDoc));
    const files = { cards: "cards.json", sites: "sites.json", index: "index.json", embeddings: "emb.bin" };
    const manifest: Manifest = {
      dataVersion: "pool",
      shardBase: V,
      embedding: { model: "m", dims: 2, quantization: "int8", scale: 127 },
      groups: { lung: ["lung"] },
      shards: [
        { id: "lung", group: "lung", kind: "full", count: 2, files, bytes: 1 },
        { id: "_all", group: "other", kind: "lite", count: 2, files, bytes: 1 },
      ],
      allShard: "_all",
      trialBase: `${V}/trials`,
    };
    const lite = cards.map((c) => ({ id: c.id, title: c.title, conditions: c.conditions, groups: c.groups, minAge: c.minAge, maxAge: c.maxAge, f: [["ecog_max", "required", 1]], b: [], ...(c.sex !== "ALL" ? { s: c.sex } : {}) }));
    const body: Record<string, string | Uint8Array> = {
      "/data/manifest.json": JSON.stringify(manifest),
      [`${V}/lung/cards.json`]: JSON.stringify(cards),
      [`${V}/lung/sites.json`]: JSON.stringify({ NCT00000011: [boston], NCT00000012: [boston] }),
      [`${V}/lung/index.json`]: JSON.stringify(index.toJSON()),
      [`${V}/lung/emb.bin`]: new Uint8Array(4),
      [`${V}/_all/cards.json`]: JSON.stringify(lite),
      [`${V}/_all/sites.json`]: JSON.stringify({ NCT00000011: [[42.34, -71.1]] }),
      [`${V}/_all/index.json`]: JSON.stringify(index.toJSON()),
      [`${V}/_all/emb.bin`]: new Uint8Array(4),
      "/data/zip/100.json": JSON.stringify({ "10001": [42.34, -71.1] }),
    };
    setFetchForTests((async (u: string) => {
      const b = body[String(u)];
      if (b === undefined) return new Response("nf", { status: 404 });
      const bytes = typeof b === "string" ? new TextEncoder().encode(b) : b;
      return new Response(bytes as BodyInit, { headers: { "content-length": String(bytes.byteLength) } });
    }) as unknown as typeof fetch);
    const state = essentials("lung", { subtype: "nsclc_adeno" });
    const pool = await buildCandidatePool(state, { catalog: TEST_CATALOG });
    expect(pool.group).toBe("lung");
    expect(pool.trials.map((t) => t.id).sort()).toEqual(["NCT00000011", "NCT00000012"]);
    expect(pool.trials.find((t) => t.id === "NCT00000011")!.prior).toBe(1);
    expect(liveCount(essentials("lung", { sex: "female" }), pool, TEST_CATALOG).total).toBe(1);
    const other = await buildCandidatePool(essentials("other"));
    expect(other.trials.map((t) => [t.id, t.sex, t.facts[0]?.param])).toEqual([["NCT00000011", "ALL", 1]]);
    // No ZIP answered (or ZIP lookup failing) => no distance filter, still a pool.
    const noZip = { ...state, answers: Object.fromEntries(Object.entries(state.answers).filter(([k]) => k !== "zip")) };
    expect((await buildCandidatePool(noZip)).trials).toHaveLength(2);
    expect((await buildCandidatePool(essentials("lung", { zip: "99999" }))).trials).toHaveLength(2);
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(buildCandidatePool(state, { signal: ac.signal })).rejects.toThrow();

    // searchTrials uses the catalog semantics when given a questionnaire + catalog.
    const out = await searchTrials(toIntakeAnswers(essentials("lung", { sex: "female" })), { catalog: TEST_CATALOG });
    expect(out.results.map((r) => r.card.id)).toEqual(["NCT00000011"]);
    // Without an explicit catalog the real catalog (config/questionnaire) is used: sex still filters.
    expect((await searchTrials(toIntakeAnswers(essentials("lung", { sex: "female" })))).results).toHaveLength(1);
    // Without a questionnaire (v1 intake) there is no sex filter.
    const { questionnaire: _q, ...v1 } = toIntakeAnswers(essentials("lung", { sex: "female" }));
    void _q;
    expect((await searchTrials(v1)).results).toHaveLength(2);
  });
});

beforeEach(() => vi.clearAllMocks());
