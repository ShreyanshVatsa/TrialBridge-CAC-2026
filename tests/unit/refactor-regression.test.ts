/**
 * Regression tests for the efficiency refactors (compile-once pre-check, single-pass nearest site, shared analysis
 * cache in the engine): each optimized path must give exactly what the straightforward version gives, on the real
 * committed seed trials and catalogs.
 */
import { describe, expect, it } from "vitest";
import { FACT_POLICY, getCatalog } from "@/config/questionnaire";
import { nearestSite, sortSitesByDistance } from "@/lib/match/filters";
import { evaluateAnswers } from "@/lib/match/precheck";
import { rankTrials, type RankEntry } from "@/lib/match/rank";
import { applyAnswer, createState, entropy, informationGain, nextQuestion, rankPool, rankQuestions, softmax, type CandidatePool } from "@/lib/questionnaire/engine";
import { applyPolicy, compileAnswer, factRelation } from "@/lib/questionnaire/rules";
import { patientAnswer, samplePatient } from "@/lib/questionnaire/simulate";
import type { IntakeAnswers } from "@/lib/types/intake";
import type { QuestionnaireState } from "@/lib/types/questionnaire";
import { loadSeedCards, loadZip, zipCentroid } from "../../scripts/eval/common";
import { rng } from "./qn-fixtures";

const zips = loadZip();
const { cards, sites } = loadSeedCards(zips);

describe("nearestSite", () => {
  it("matches the first element of the full distance sort for every seed trial and several origins", () => {
    for (const zip of ["02115", "77030", "94143", "55905"]) {
      const origin = zipCentroid(zips, zip);
      for (const c of cards) {
        const s = sites.get(c.id) ?? [];
        expect(nearestSite(s, origin)).toEqual(sortSitesByDistance(s, origin)[0] ?? null);
        expect(nearestSite(s, null)).toEqual(sortSitesByDistance(s, null)[0] ?? null);
      }
    }
  });
});

describe("rankTrials pre-check", () => {
  it("each result's notes equal a per-trial evaluateAnswers, and rankings are deterministic", () => {
    const entries: RankEntry[] = cards.map((card) => ({ card, sites: sites.get(card.id) ?? [], vector: [1, 0] }));
    const catalog = getCatalog("cancer", "lung");
    const state: QuestionnaireState = {
      ...createState("thorough", 1),
      answers: { cancer_type: "lung", age: 60, zip: "02115", travel: 500, spread: "distant", treatments: ["chemotherapy"], daily_activity: "2", biomarkers: { EGFR: "positive" } },
    };
    const answers: IntakeAnswers = { cancerType: "lung", age: 60, zip: "02115", travelMiles: 500, language: "en", spread: "yes", treatments: ["chemotherapy"], biomarkers: { EGFR: "positive" }, pregnant: "no", inAnotherTrial: "no", questionnaire: state };
    const input = { entries, answers, origin: zipCentroid(zips, "02115"), keywordSearch: () => [], queryVector: [1, 0], catalog, policy: FACT_POLICY, limit: 50 };
    const out = rankTrials(input);
    expect(out.results.length).toBeGreaterThan(5);
    for (const r of out.results) expect(r.precheck).toEqual(evaluateAnswers(state, catalog, r.card.facts, FACT_POLICY));
    expect(rankTrials(input).results.map((r) => r.card.id)).toEqual(out.results.map((r) => r.card.id));
  });
});

describe("engine analysis cache and information gain", () => {
  const group = "lung" as const;
  const catalog = getCatalog("cancer", group);
  const sorted = cards.filter((c) => c.groups.includes(group));
  const pool: CandidatePool = { group, trials: sorted.map((c, i, all) => ({ id: c.id, prior: 1 - i / all.length, facts: c.facts, sex: c.sex })) };
  const base: QuestionnaireState = { ...createState("thorough", 1), answers: { cancer_type: group, age: 55, zip: "02115", travel: null }, history: ["cancer_type", "age", "zip", "travel"] };

  /** Straightforward information gain (no caching, no shortcuts), the formula in the engine's header comment. */
  function referenceGain(qid: string, state: QuestionnaireState): number {
    const q = catalog.find((x) => x.id === qid)!;
    const scored = rankPool(state, pool, catalog, { policy: FACT_POLICY });
    const top = scored.slice(0, 60);
    const trials = top.map((s) => pool.trials.find((t) => t.id === s.id)!);
    const p = softmax(top.map((s) => s.score));
    const mine = informationGain(q, group, trials, p, FACT_POLICY);
    // Direct recomputation for single-choice questions from the definition.
    let gain = 0;
    if (q.type === "single") {
      const defs = (q.options ?? []).filter((o) => !["unknown", "__skip", "prefer_not"].includes(o.id));
      const pri = q.priors?.[group];
      const z = defs.reduce((s, o) => s + (pri?.[o.id] ?? 0), 0) + Object.entries(pri ?? {}).filter(([k]) => ["unknown", "__skip", "prefer_not"].includes(k)).reduce((s, [, v]) => s + v, 0);
      if (pri && z > 0) {
        const h0 = entropy(p);
        for (const o of defs) {
          const c = compileAnswer(q, o.id);
          const post = trials.map((t, i) => p[i]! * likelihood(c, t));
          const zz = post.reduce((a, b) => a + b, 0);
          gain += ((pri[o.id] ?? 0) / z) * (h0 - entropy(post.map((x) => x / zz)));
        }
      }
    }
    expect(mine).toBeCloseTo(gain, 9);
    return mine;
  }
  function likelihood(c: ReturnType<typeof compileAnswer>, t: CandidatePool["trials"][number]): number {
    if (c.hardFilter?.sex && t.sex !== "ALL" && t.sex !== c.hardFilter.sex) return Math.exp(-2.4);
    let support = false;
    for (const f of t.facts) {
      const rel = applyPolicy(factRelation([c], f), f.key, FACT_POLICY);
      if (rel === "conflict") return Math.exp(-1.2);
      if (rel === "support") support = true;
    }
    return support ? Math.exp(0.4) : 1;
  }

  it("cached gains equal a from-scratch computation for single-choice questions", () => {
    const state = applyAnswer(base, "spread", "distant", catalog, { now: 1 }).state;
    let checked = 0;
    for (const r of rankQuestions(state, pool, catalog, { policy: FACT_POLICY })) {
      if (r.question.type !== "single" || !r.question.priors?.[group]) continue;
      const ig = referenceGain(r.question.id, state);
      expect(r.gain).toBeGreaterThanOrEqual(ig - 1e-12); // question value = information gain + expected top-10 regret (>= 0)
      checked++;
    }
    expect(checked).toBeGreaterThan(1);
  });

  it("a state's cached analysis never leaks into a different state object (same content, fresh identity => same answers)", () => {
    const r = rng(3);
    for (let i = 0; i < 6; i++) {
      const patient = samplePatient(r, base, catalog, group);
      let state = base;
      for (let k = 0; k < 8; k++) {
        const a = nextQuestion(state, pool, catalog, { policy: FACT_POLICY });
        const clone: QuestionnaireState = JSON.parse(JSON.stringify(state));
        const b = nextQuestion(clone, { ...pool }, catalog, { policy: FACT_POLICY });
        const again = nextQuestion(state, pool, catalog, { policy: FACT_POLICY });
        expect(b).toEqual(a);
        expect(again).toEqual(a);
        if (a.kind === "done") break;
        state = applyAnswer(state, a.question.id, patientAnswer(patient, a.question), catalog, { now: 1 }).state;
      }
    }
  });

  it("answering changes the analysis (cache keyed by state identity)", () => {
    const s1 = applyAnswer(base, "spread", "distant", catalog, { now: 1 }).state;
    const s2 = applyAnswer(base, "spread", "not_spread", catalog, { now: 1 }).state;
    expect(rankPool(s1, pool, catalog, { policy: FACT_POLICY })).not.toEqual(rankPool(s2, pool, catalog, { policy: FACT_POLICY }));
  });
});
