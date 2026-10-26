/**
 * The engine against the real catalog (config/questionnaire) and the committed seed trials.
 */
import { describe, expect, it } from "vitest";
import { CANCER_GROUP_IDS, type CancerGroupId } from "@/config/cancer-groups";
import { FACT_POLICY, getCatalog, getFindOutItems } from "@/config/questionnaire";
import { applyAnswer, createState, eligibleQuestions, findOutList, liveCount, nextQuestion, type CandidatePool } from "@/lib/questionnaire/engine";
import { compileAnswer } from "@/lib/questionnaire/rules";
import { toIntakeAnswers } from "@/lib/questionnaire/adapter";
import { minimizeProfile } from "@/lib/privacy/minimize";
import { MinimizedProfileSchema } from "@/lib/types/analysis";
import type { AnswerValue, QuestionDef, QuestionnaireState } from "@/lib/types/questionnaire";
import { loadSeedCards } from "@/scripts/eval/common";
import { rng, pick } from "./qn-fixtures";

const { cards } = loadSeedCards(new Map());
function seedPool(group: CancerGroupId): CandidatePool {
  const trials = cards.filter((c) => group === "other" || c.groups.includes(group)).map((c, i, all) => ({ id: c.id, prior: 1 - i / all.length, facts: c.facts, sex: c.sex }));
  return { group, trials };
}
function start(group: CancerGroupId, age = 45, extra: Record<string, AnswerValue> = {}): QuestionnaireState {
  return { ...createState("quick", 1), answers: { cancer_type: group, age, zip: "02115", travel: 100, ...extra }, history: ["cancer_type", "age", "zip", "travel", ...Object.keys(extra)] };
}
const definite = (q: QuestionDef, r: () => number): AnswerValue => {
  const ids = (q.options ?? []).map((o) => o.id);
  if (q.type === "multi") return [pick(r, ids)];
  if (q.type === "biomarker_grid") return Object.fromEntries((q.biomarkers ?? []).slice(0, 2).map((b) => [b, pick(r, ["positive", "negative", "not_tested"])]));
  return pick(r, ids);
};

describe("engine x real catalog", { timeout: 120_000 }, () => {
  it("every group: all-unknown and random flows stop within the quick limit, and unknowns never shrink the counter", () => {
    const r = rng(3);
    for (const g of CANCER_GROUP_IDS) {
      const catalog = getCatalog("cancer", g);
      const pool = seedPool(g);
      const base = start(g);
      const before = liveCount(base, pool, catalog, { policy: FACT_POLICY });
      for (const mode of ["unknown", "random"] as const) {
        let s = base;
        let asked = 0;
        for (;;) {
          const step = nextQuestion(s, pool, catalog, { policy: FACT_POLICY });
          if (step.kind === "done") break;
          asked++;
          const v = mode === "unknown" ? (step.question.type === "multi" ? ["unknown"] : "unknown") : definite(step.question, r);
          s = applyAnswer(s, step.question.id, v, catalog, { gain: step.utility }).state;
          if (mode === "unknown") expect(liveCount(s, pool, catalog, { policy: FACT_POLICY })).toEqual(before);
          expect(asked, g).toBeLessThanOrEqual(7);
        }
        expect(MinimizedProfileSchema.safeParse(minimizeProfile(toIntakeAnswers(s))).success, g).toBe(true);
      }
    }
  });

  it("non-response options carry no effect in any group", () => {
    for (const g of CANCER_GROUP_IDS)
      for (const q of getCatalog("cancer", g))
        for (const v of ["unknown", "__skip", "prefer_not", "deferred", null] as AnswerValue[]) {
          const c = compileAnswer(q, v);
          expect(c.rules.size + c.queryTerms.length + (c.hardFilter ? 1 : 0), `${g}/${q.id}`).toBe(0);
        }
  });

  it("every option of every aiField question minimizes to a valid profile", () => {
    for (const g of CANCER_GROUP_IDS) {
      for (const q of getCatalog("cancer", g).filter((x) => x.aiField)) {
        for (const o of q.options ?? []) {
          const v: AnswerValue = q.type === "multi" ? [o.id] : o.id;
          const p = minimizeProfile(toIntakeAnswers(start(g, 45, { [q.id]: v })));
          expect(MinimizedProfileSchema.safeParse(p).success, `${g}/${q.id}=${o.id}`).toBe(true);
        }
      }
    }
  });

  it("breast does not ask pregnancy first; pregnancy honors maxAge and is dropped when age is edited past it", () => {
    const catalog = getCatalog("cancer", "breast");
    const first = nextQuestion(start("breast", 45), seedPool("breast"), catalog, { policy: FACT_POLICY });
    expect(first.kind === "ask" && first.question.id).not.toBe("pregnancy");
    expect(eligibleQuestions(start("breast", 65), seedPool("breast"), catalog).map((q) => q.id)).not.toContain("pregnancy");
    expect(eligibleQuestions(start("breast", 45), seedPool("breast"), catalog).map((q) => q.id)).toContain("pregnancy");
    const answered = start("breast", 45, { pregnancy: "no" });
    const edited = applyAnswer(answered, "age", 65, catalog);
    expect(edited.dropped).toEqual(["pregnancy"]);
    expect(edited.state.answers["pregnancy"]).toBeUndefined();
  });

  it("changing the cancer type drops or trims answers the new group's catalog does not offer", () => {
    const lung = getCatalog("cancer", "lung");
    const subtype = lung.find((q) => q.id === "subtype")!.options![0]!.id;
    let s = start("lung", 60, { subtype, biomarkers: { EGFR: "positive", BRAF: "negative" }, spread: "distant", group_status: "crpc" });
    s = applyAnswer(s, "spread", "distant", lung).state; // a lung catalog drops the stray prostate-only answer
    expect(s.answers["group_status"]).toBeUndefined();
    const breast = getCatalog("cancer", "breast");
    const r = applyAnswer(s, "cancer_type", "breast", breast);
    expect(r.state.answers["subtype"]).toBeUndefined();
    expect(r.state.answers["spread"]).toBe("distant");
    const bm = r.state.answers["biomarkers"];
    const breastMarkers: readonly string[] = breast.find((q) => q.id === "biomarkers")?.biomarkers ?? [];
    if (bm && typeof bm === "object" && !Array.isArray(bm)) for (const m of Object.keys(bm)) expect(breastMarkers).toContain(m);
    expect(r.state.answers["biomarkers"] === undefined || !("EGFR" in (r.state.answers["biomarkers"] as object))).toBe(true);
    expect(r.dropped).toContain("subtype");
    expect(r.dropped).toContain("biomarkers");
  });

  it("travel 'anywhere' stored as null or 'anywhere' counts as answered", () => {
    const catalog = getCatalog("cancer", "lung");
    for (const travel of [null, "anywhere"] as AnswerValue[]) {
      const step = nextQuestion(start("lung", 60, { travel }), seedPool("lung"), catalog);
      expect(step.kind === "ask" ? step.question.tier : "done", String(travel)).not.toBe("essential");
      expect(toIntakeAnswers(start("lung", 60, { travel })).travelMiles).toBeNull();
    }
  });

  it("find-out items resolve through the catalog's find-out ids", () => {
    const catalog = getCatalog("cancer", "lung");
    const s = applyAnswer(start("lung"), "biomarkers", { EGFR: "unknown" }, catalog, { gain: 0.3 }).state;
    const list = findOutList(s, catalog, getFindOutItems());
    expect(list.map((e) => e.question)).toEqual(["biomarkers"]);
    expect(list[0]!.whereKey).not.toBe(list[0]!.whatKey);
  });
});
