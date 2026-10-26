import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAnswer,
  clearSession,
  createState,
  eligibleQuestions,
  entropy,
  estimateRemaining,
  findOutList,
  findOutQuestions,
  goBack,
  informationGain,
  liveCount,
  loadSession,
  nextQuestion,
  rankQuestions,
  remainingOptional,
  saveSession,
  setMode,
  softmax,
  unknownPrior,
  type CandidatePool,
} from "@/lib/questionnaire/engine";
import { SESSION_KEY, SESSION_MAX_AGE_MS, STOP_RULES, TAU } from "@/lib/questionnaire/constants";
import type { QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { essentials, FIND_OUT, makePool, TEST_CATALOG } from "./qn-fixtures";

const Q = (id: string) => TEST_CATALOG.find((q) => q.id === id) as QuestionDef;
const POOL = makePool(7);

function answerAll(state: QuestionnaireState, pool: CandidatePool, answer: (q: QuestionDef) => Parameters<typeof applyAnswer>[2], catalog = TEST_CATALOG) {
  const asked: string[] = [];
  let s = state;
  for (let i = 0; i < 40; i++) {
    const step = nextQuestion(s, pool, catalog);
    if (step.kind === "done") return { state: s, asked, reason: step.reason };
    asked.push(step.question.id);
    s = applyAnswer(s, step.question.id, answer(step.question), catalog, { gain: Number.isFinite(step.utility) ? step.utility : 0, now: 2_000 }).state;
  }
  throw new Error("did not stop");
}

describe("engine: essentials", () => {
  it("asks the essentials first, in fixed order", () => {
    let s = createState("quick", 0);
    const order: string[] = [];
    const values: Record<string, Parameters<typeof applyAnswer>[2]> = { cancer_type: "lung", age: 55, zip: "10001", travel: 100 };
    for (let i = 0; i < 4; i++) {
      const step = nextQuestion(s, { group: "lung", trials: [] }, TEST_CATALOG);
      expect(step.kind).toBe("ask");
      if (step.kind !== "ask") return;
      expect(step.utility).toBe(Infinity);
      expect(step.impact).toEqual({ total: 0, narrowedTo: null });
      order.push(step.question.id);
      s = applyAnswer(s, step.question.id, values[step.question.id] ?? null, TEST_CATALOG, { now: 1 }).state;
    }
    expect(order).toEqual(["cancer_type", "age", "zip", "travel"]);
    expect(estimateRemaining(createState(), POOL, TEST_CATALOG)).toBe(4);
  });

  it("asks other essential-tier catalog questions after the fixed four", () => {
    const extra = { ...Q("phase_pref"), id: "consent", tier: "essential" } as unknown as QuestionDef;
    const step = nextQuestion(essentials(), POOL, [...TEST_CATALOG, extra]);
    expect(step.kind === "ask" && step.question.id).toBe("consent");
    const notApplicable = { ...extra, appliesTo: ["breast"] } as unknown as QuestionDef;
    expect(nextQuestion(essentials(), POOL, [...TEST_CATALOG, notApplicable]).kind === "ask").toBe(true);
  });
});

describe("engine: selection", () => {
  it("is deterministic and only picks eligible questions", () => {
    const a = nextQuestion(essentials(), POOL, TEST_CATALOG);
    const b = nextQuestion(essentials(), POOL, TEST_CATALOG);
    expect(a).toEqual(b);
    const eligible = eligibleQuestions(essentials(), POOL, TEST_CATALOG).map((q) => q.id);
    expect(eligible).not.toContain("measurable"); // disabled
    expect(eligible).not.toContain("brain_mets"); // prerequisite (spread) not met
    expect(eligible).toContain("lines"); // negated prerequisite (treatments not "none") holds while unanswered
    expect(a.kind === "ask" && eligible.includes(a.question.id)).toBe(true);
  });

  it("never picks a question for another group, already answered, or deferred", () => {
    const res = answerAll(essentials("breast"), makePool(3, 120, "breast"), () => "unknown");
    expect(res.asked).not.toContain("subtype");
    expect(new Set(res.asked).size).toBe(res.asked.length);
    const deferred = applyAnswer(essentials(), "biomarkers", "deferred", TEST_CATALOG, { now: 5 }).state;
    expect(eligibleQuestions(deferred, POOL, TEST_CATALOG).map((q) => q.id)).not.toContain("biomarkers");
  });

  it("IG is 0 when no candidate has the fact, and when P(unknown) = 1", () => {
    const pool: CandidatePool = { group: "lung", trials: POOL.trials.map((t) => ({ ...t, facts: [], sex: "ALL" as const })) };
    const p = softmax(pool.trials.slice(0, 60).map((t) => t.prior));
    for (const q of TEST_CATALOG) expect(informationGain(q, "lung", pool.trials.slice(0, 60), p)).toBe(0);
    const daily = { ...Q("daily_activity"), priors: { lung: { unknown: 1 } } } as unknown as QuestionDef;
    const top = POOL.trials.slice(0, 60);
    expect(informationGain(daily, "lung", top, softmax(top.map((t) => t.prior)))).toBe(0);
    expect(informationGain(Q("daily_activity"), "lung", top, softmax(top.map((t) => t.prior)))).toBeGreaterThan(0);
    expect(informationGain(Q("daily_activity"), "lung", [], [])).toBe(0);
    expect(unknownPrior(daily, "lung")).toBe(1);
    expect(unknownPrior(Q("phase_pref"), "lung")).toBeCloseTo(0.2, 12);
    expect(unknownPrior(Q("cancer_type"), "lung")).toBe(0);
    expect(unknownPrior({ ...Q("phase_pref"), options: [{ id: "unknown", labelKey: "questionnaire.x" }] } as unknown as QuestionDef, "lung")).toBe(1);
  });

  it("entropy and softmax basics", () => {
    expect(entropy([0.5, 0.5])).toBeCloseTo(1, 12);
    expect(entropy([1, 0])).toBe(0);
    expect(softmax([])).toEqual([]);
    const s = softmax([0, TAU]);
    expect(s[1]! / s[0]!).toBeCloseTo(Math.E, 9);
  });

  it("a question that splits the top candidates beats one that does not", () => {
    const trials = Array.from({ length: 40 }, (_, i) => ({ id: `NCT${10000000 + i}`, prior: 0.5, sex: "ALL" as const, facts: i % 2 ? [{ key: "ecog_max" as const, value: "required" as const, param: 1 }] : [] }));
    const ranked = rankQuestions(essentials(), { group: "lung", trials }, TEST_CATALOG);
    const best = [...ranked].sort((a, b) => b.utility - a.utility)[0]!;
    expect(best.question.id).toBe("daily_activity");
    expect(ranked.find((r) => (r.question.id as string) === "spread")!.gain).toBe(0);
  });

  it("asks sex only when >= 5% of candidates are sex-restricted, and it narrows `total`", () => {
    const allSexes = { group: "lung" as const, trials: POOL.trials.map((t) => ({ ...t, sex: "ALL" as const })) };
    expect(eligibleQuestions(essentials(), allSexes, TEST_CATALOG).map((q) => q.id)).not.toContain("sex");
    expect(eligibleQuestions(essentials(), { group: "lung", trials: [] }, TEST_CATALOG).map((q) => q.id)).not.toContain("sex");
    expect(eligibleQuestions(essentials(), POOL, TEST_CATALOG).map((q) => q.id)).toContain("sex");
    const before = liveCount(essentials(), POOL, TEST_CATALOG);
    const female = liveCount(essentials("lung", { sex: "female" }), POOL, TEST_CATALOG);
    const prefer = liveCount(essentials("lung", { sex: "prefer_not" }), POOL, TEST_CATALOG);
    expect(female.total).toBe(POOL.trials.filter((t) => t.sex !== "MALE").length);
    expect(female.total).toBeLessThan(before.total);
    expect(prefer).toEqual(before);
  });

  it("impact preview: could narrow N to M, null when nothing changes", () => {
    const pool: CandidatePool = {
      group: "lung",
      trials: Array.from({ length: 30 }, (_, i) => ({ id: `NCT${10000000 + i}`, prior: 0.5, sex: "ALL" as const, facts: i < 10 ? [{ key: "ecog_max" as const, value: "required" as const, param: 1 }] : [] })),
    };
    const catalog = TEST_CATALOG.filter((q) => q.tier === "essential" || q.id === "daily_activity");
    const step = nextQuestion(essentials(), pool, catalog);
    expect(step.kind === "ask" && step.question.id).toBe("daily_activity");
    if (step.kind === "ask") expect(step.impact).toEqual({ total: 30, narrowedTo: 20 });
    const step2 = nextQuestion(essentials(), { group: "lung", trials: pool.trials.map((t) => ({ ...t, facts: [{ key: "ecog_max" as const, value: "required" as const, param: 4 }] })) }, [...catalog, { ...Q("phase_pref"), tier: "helpful" } as unknown as QuestionDef]);
    // ecog_max 4 everywhere: answers only support, nothing narrows; IG is 0 so it stops for low gain.
    expect(step2).toEqual({ kind: "done", reason: "low_gain" });
  });
});

describe("engine: stop rules", () => {
  it("quick mode asks at most 7 adaptive questions", () => {
    const catalog = [...TEST_CATALOG, ...Array.from({ length: 10 }, (_, i) => ({ ...Q("daily_activity"), id: `extra_${i}` }) as unknown as QuestionDef)];
    const first = (q: QuestionDef) => (q.type === "multi" ? [q.options![0]!.id] : q.type === "biomarker_grid" ? { EGFR: "positive" } : (q.options?.[0]?.id ?? "unknown"));
    const res = answerAll(essentials(), POOL, first, catalog);
    expect(res.asked.length).toBeLessThanOrEqual(STOP_RULES.quick.maxQuestions);
    expect(["max_questions", "small_set", "low_gain", "exhausted"]).toContain(res.reason);
    const many = { ...essentials(), history: [...essentials().history, ...Array.from({ length: 7 }, (_, i) => `extra_${i}`)], answers: { ...essentials().answers, ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`extra_${i}`, "unknown"])) } };
    expect(nextQuestion(many, POOL, catalog)).toEqual({ kind: "done", reason: "max_questions" });
    expect(nextQuestion(setMode(many, "thorough", 3), POOL, catalog).kind).toBe("ask");
  });

  it("stops when no eligible questions remain", () => {
    const catalog = TEST_CATALOG.filter((q) => q.tier === "essential");
    expect(nextQuestion(essentials(), POOL, catalog)).toEqual({ kind: "done", reason: "exhausted" });
    expect(estimateRemaining(essentials(), POOL, catalog)).toBe(0);
  });

  it("stops when the no-conflict set is small (quick) but not in thorough mode", () => {
    const small = { group: "lung" as const, trials: POOL.trials.slice(0, 12) };
    expect(nextQuestion(essentials(), small, TEST_CATALOG)).toEqual({ kind: "done", reason: "small_set" });
    expect(nextQuestion(setMode(essentials(), "thorough"), small, TEST_CATALOG).kind).toBe("ask");
  });

  it("stops for low gain when nothing can move the ranking", () => {
    const flat = { group: "lung" as const, trials: POOL.trials.map((t) => ({ ...t, facts: [], sex: "ALL" as const })) };
    expect(nextQuestion(essentials(), flat, TEST_CATALOG)).toEqual({ kind: "done", reason: "low_gain" });
    expect(nextQuestion(setMode(essentials(), "thorough"), flat, TEST_CATALOG)).toEqual({ kind: "done", reason: "low_gain" });
  });

  it("deep questions are demoted in quick mode only", () => {
    const trials = Array.from({ length: 40 }, (_, i) => ({ id: `NCT${10000000 + i}`, prior: 0.5, sex: "ALL" as const, facts: i % 2 ? [{ key: "concurrent_trial" as const, value: "excluded" as const }] : [] }));
    const u = (mode: "quick" | "thorough") => rankQuestions(setMode(essentials(), mode), { group: "lung", trials }, TEST_CATALOG).find((r) => (r.question.id as string) === "in_other_trial")!;
    expect(u("quick").utility).toBeCloseTo(u("thorough").utility * 0.6, 12);
  });

  it("two 'don't know' answers in a row down-weight that kind of question when it is often unknown", () => {
    const hard = (id: string) => ({ ...Q("daily_activity"), id, priors: { lung: { "0-1": 0.1, "2": 0.1, "3-4": 0.1, unknown: 0.7 } } }) as unknown as QuestionDef;
    const catalog = [...TEST_CATALOG, hard("h1"), hard("h2"), hard("h3")];
    const base = essentials();
    // Same answers, different order: only the streak at the end of the history differs.
    const answers = { ...base.answers, h1: "unknown", h2: "__skip", phase_pref: "no_pref" };
    const streak = { ...base, answers, history: [...base.history, "phase_pref", "h1", "h2"] };
    const oneOnly = { ...base, answers, history: [...base.history, "h1", "phase_pref", "h2"] };
    const u3 = (s: QuestionnaireState) => rankQuestions(s, POOL, catalog).find((r) => (r.question.id as string) === "h3")!.utility;
    expect(u3(streak)).toBeCloseTo(u3(oneOnly) * 0.5, 12);
    const daily = (s: QuestionnaireState) => rankQuestions(s, POOL, catalog).find((r) => (r.question.id as string) === "daily_activity")!.utility;
    expect(daily(streak)).toBeCloseTo(daily(oneOnly), 12); // P(unknown) 0.2 < 0.6: not demoted
    // A grid with two unknown markers counts as two.
    const gridCat = [...TEST_CATALOG, { ...Q("biomarkers"), id: "deep_bm", priors: { lung: { unknown: 0.9 } } } as unknown as QuestionDef];
    const g = { ...base, answers: { ...base.answers, biomarkers: { EGFR: "unknown", ALK: "not_tested" } }, history: [...base.history, "biomarkers"] };
    const g1 = { ...base, answers: { ...base.answers, biomarkers: { EGFR: "positive" } }, history: [...base.history, "biomarkers"] };
    const ud = (s: QuestionnaireState) => rankQuestions(s, POOL, gridCat).find((r) => (r.question.id as string) === "deep_bm")!;
    expect(ud(g).utility / ud(g).gain).toBeCloseTo((ud(g1).utility / ud(g1).gain) * 0.5, 9);
  });
});

describe("engine: answers, back and edit", () => {
  it("applyAnswer records history once, gains, and deferral", () => {
    let { state } = applyAnswer(essentials(), "spread", "metastatic", TEST_CATALOG, { gain: 0.4, now: 9 });
    expect(state.history.at(-1)).toBe("spread");
    expect(state.gains).toEqual({ spread: 0.4 });
    expect(state.updatedAt).toBe(9);
    state = applyAnswer(state, "spread", "early", TEST_CATALOG, { gain: Infinity }).state;
    expect(state.history.filter((x) => x === "spread")).toHaveLength(1);
    state = applyAnswer(state, "biomarkers", "deferred", TEST_CATALOG).state;
    expect(state.answers.biomarkers).toBeNull();
    expect(state.deferred).toEqual(["biomarkers"]);
    state = applyAnswer(state, "biomarkers", { EGFR: "positive" }, TEST_CATALOG).state;
    expect(state.deferred).toEqual([]);
  });

  it("editing an answer drops dependents whose prerequisite no longer holds (cascading)", () => {
    let s = essentials("lung", { spread: "metastatic", brain_mets: "active", treatments: ["chemotherapy"], lines: "2" });
    s = { ...s, deferred: ["brain_mets"], gains: { brain_mets: 1 } };
    const r = applyAnswer(s, "spread", "early", TEST_CATALOG);
    expect(r.dropped).toEqual(["brain_mets"]);
    expect(r.state.answers.brain_mets).toBeUndefined();
    expect(r.state.history).not.toContain("brain_mets");
    expect(r.state.deferred).toEqual([]);
    expect(r.state.gains).toEqual({});
    const r2 = applyAnswer(s, "treatments", ["none"], TEST_CATALOG);
    expect(r2.dropped).toEqual(["lines"]);
    // Changing the cancer type drops answers to questions for the old group only.
    const r3 = applyAnswer(essentials("lung", { subtype: "sclc", spread: "metastatic" }), "cancer_type", "breast", TEST_CATALOG);
    expect(r3.dropped).toEqual(["subtype"]);
  });

  it("goBack pops the last question, returns its answer, and re-asks the same question", () => {
    const start = essentials();
    const step = nextQuestion(start, POOL, TEST_CATALOG);
    if (step.kind !== "ask") throw new Error("expected a question");
    const answered = applyAnswer(start, step.question.id, step.question.options?.[0]?.id ?? "unknown", TEST_CATALOG, { now: 2 }).state;
    const back = goBack(answered, 3);
    expect(back.question).toBe(step.question.id);
    expect(back.previous).toBe(step.question.options?.[0]?.id ?? "unknown");
    expect(nextQuestion(back.state, POOL, TEST_CATALOG)).toEqual(step);
    expect(goBack(createState()).question).toBeNull();
    const deferred = applyAnswer(start, "biomarkers", "deferred", TEST_CATALOG).state;
    expect(goBack(deferred).previous).toBe("deferred");
  });
});

describe("engine: counters and lists", () => {
  it("liveCount counts total, no-conflict and supported", () => {
    const pool: CandidatePool = {
      group: "lung",
      trials: [
        { id: "NCT00000001", prior: 1, sex: "ALL", facts: [{ key: "metastatic", value: "required" }] },
        { id: "NCT00000002", prior: 1, sex: "ALL", facts: [{ key: "metastatic", value: "excluded" }] },
        { id: "NCT00000003", prior: 1, sex: "ALL", facts: [] },
      ],
    };
    expect(liveCount(essentials("lung", { spread: "metastatic" }), pool, TEST_CATALOG)).toEqual({ total: 3, noConflict: 2, supported: 1 });
    expect(liveCount(essentials("lung", { spread: "unknown" }), pool, TEST_CATALOG)).toEqual({ total: 3, noConflict: 3, supported: 0 });
  });

  it("remainingOptional counts eligible deep-dive questions", () => {
    expect(remainingOptional(essentials(), POOL, TEST_CATALOG)).toBe(3); // hiv, in_other_trial, phase_pref
  });

  it("findOutList: only unknown/skipped/deferred items with a definition, most useful first, deduped", () => {
    let s = essentials();
    s = applyAnswer(s, "daily_activity", "unknown", TEST_CATALOG, { gain: 0.2 }).state;
    s = applyAnswer(s, "biomarkers", { EGFR: "unknown", ALK: "positive" }, TEST_CATALOG, { gain: 0.5 }).state;
    s = applyAnswer(s, "spread", "metastatic", TEST_CATALOG, { gain: 0.9 }).state;
    s = applyAnswer(s, "subtype", "prefer_not", TEST_CATALOG, { gain: 0.9 }).state;
    s = applyAnswer(s, "pregnancy", "__skip", TEST_CATALOG, { gain: 0.1 }).state;
    const list = findOutList(s, TEST_CATALOG, FIND_OUT);
    expect(list.map((e) => e.question)).toEqual(["biomarkers", "daily_activity"]);
    expect(list[0]).toEqual({ question: "biomarkers", ...FIND_OUT.biomarkers, deferred: false });
    // Without explicit items, the question's findOutKey is used; deferred items are flagged.
    s = applyAnswer(s, "biomarkers", "deferred", TEST_CATALOG).state;
    s = applyAnswer(s, "subtype", ["unknown"], TEST_CATALOG).state;
    const plain = findOutList(s, TEST_CATALOG);
    expect(plain.find((e) => e.question === "biomarkers")).toMatchObject({ whatKey: "findOut.biomarkers.what", deferred: true });
    expect(plain.map((e) => e.question)).toContain("subtype");
    expect(findOutQuestions(s, TEST_CATALOG)).toEqual(plain.map((e) => e.question));
    // Two questions sharing the same "what to ask" item appear once.
    const twin = [...TEST_CATALOG, { ...Q("daily_activity"), id: "daily_twin" } as unknown as QuestionDef];
    const s2 = applyAnswer(applyAnswer(essentials(), "daily_activity", "unknown", twin).state, "daily_twin", "unknown", twin).state;
    expect(findOutList(s2, twin).map((e) => e.question)).toEqual(["daily_activity"]);
  });
});

describe("engine: session resume (sessionStorage only)", () => {
  afterEach(() => vi.unstubAllGlobals());
  function fakeStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  }

  it("saves, loads, validates, expires and clears", () => {
    const st = fakeStorage();
    vi.stubGlobal("sessionStorage", st);
    const s = essentials("lung", { spread: "metastatic" });
    saveSession(s);
    expect(st.m.has(SESSION_KEY)).toBe(true);
    expect(loadSession(s.updatedAt + 1000)).toEqual(s);
    expect(loadSession(s.updatedAt + SESSION_MAX_AGE_MS + 1)).toBeNull();
    expect(st.m.has(SESSION_KEY)).toBe(false);
    st.setItem(SESSION_KEY, JSON.stringify({ ...s, extra: 1 }));
    expect(loadSession(s.updatedAt)).toBeNull();
    st.setItem(SESSION_KEY, "{not json");
    expect(loadSession(s.updatedAt)).toBeNull();
    expect(loadSession()).toBeNull();
    saveSession(s);
    clearSession();
    expect(st.m.size).toBe(0);
  });

  it("never throws when storage is missing or broken", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(loadSession()).toBeNull();
    saveSession(createState());
    clearSession();
    const boom = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("sessionStorage", { getItem: boom, setItem: boom, removeItem: boom });
    saveSession(createState());
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
