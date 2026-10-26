import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ndcgGraded, toTrecTrial, trecBm25Baseline, withPlaceholderSite, type StructuredAnswers } from "@/scripts/eval/trec/load";
import { parseQrels } from "@/scripts/eval/trec/qrels";
import { parseTopicsXml } from "@/scripts/eval/trec/select-topics";
import type { RawLocation, RawStudy } from "@/lib/ingest/raw";
import { getCatalog } from "@/config/questionnaire";
import { CANCER_GROUP_IDS } from "@/config/cancer-groups";

const ELIG = "Inclusion Criteria:\n\n* Histologically confirmed metastatic pancreatic adenocarcinoma\n* Age 18 or older\n\nExclusion Criteria:\n\n* Pregnant or breastfeeding";

function rawStudy(locations: RawLocation[]): RawStudy {
  return {
    protocolSection: {
      identificationModule: { nctId: "NCT01234567", briefTitle: "Gemcitabine for Metastatic Pancreatic Cancer" },
      statusModule: { overallStatus: "RECRUITING", lastUpdatePostDateStruct: { date: "2024-01-02" } },
      conditionsModule: { conditions: ["Pancreatic Adenocarcinoma"] },
      designModule: { phases: ["PHASE2"] },
      eligibilityModule: { eligibilityCriteria: ELIG, minimumAge: "18 Years", sex: "ALL" },
      contactsLocationsModule: { locations },
    },
    derivedSection: { conditionBrowseModule: { meshes: [{ term: "Pancreatic Neoplasms" }], ancestors: [{ term: "Neoplasms" }] } },
  };
}

describe("ndcgGraded", () => {
  const qrels = { a: 2, b: 0, c: 1, d: 2 };
  it("matches a hand-computed value", () => {
    // DCG = 2/log2(2) + 0/log2(3) + 1/log2(4) = 2.5; IDCG over [2, 2, 1] = 2 + 2/log2(3) + 0.5
    const idcg = 2 + 2 / Math.log2(3) + 0.5;
    expect(ndcgGraded(["a", "b", "c"], qrels, 3)).toBeCloseTo(2.5 / idcg, 10);
    expect(ndcgGraded(["a", "b", "c"], qrels, 3)).toBeCloseTo(0.6646, 3);
  });
  it("is 1 for an ideal ranking and respects k", () => {
    expect(ndcgGraded(["a", "d", "c", "b"], qrels, 4)).toBe(1);
    expect(ndcgGraded(["d", "a"], qrels, 2)).toBe(1);
    // k = 1: DCG = gain of first = 1; IDCG = 2
    expect(ndcgGraded(["c", "a", "d"], qrels, 1)).toBeCloseTo(0.5, 10);
  });
  it("treats unjudged ids as gain 0 and returns 0 when nothing is relevant", () => {
    expect(ndcgGraded(["zzz", "b"], qrels, 10)).toBe(0);
    expect(ndcgGraded(["a"], { x: 0, y: 0 }, 10)).toBe(0);
    expect(ndcgGraded([], qrels, 10)).toBe(0);
  });
});

describe("withPlaceholderSite / toTrecTrial", () => {
  it("adds one synthetic U.S. site to a study with no usable U.S. site and flags it", () => {
    const raw = rawStudy([{ facility: "Charite", city: "Berlin", country: "Germany", status: "RECRUITING" }]);
    const { study, synthetic } = withPlaceholderSite(raw);
    expect(synthetic).toBe(true);
    const locs = study.protocolSection.contactsLocationsModule?.locations ?? [];
    expect(locs).toHaveLength(2);
    expect(locs[1]).toMatchObject({ facility: "TREC placeholder", country: "United States", status: "RECRUITING" });
    expect(locs[1]?.geoPoint).toBeUndefined();
    expect(raw.protocolSection.contactsLocationsModule?.locations).toHaveLength(1); // input not mutated

    const r = toTrecTrial(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trial.syntheticSite).toBe(true);
    expect(r.trial.card.id).toBe("NCT01234567");
    expect(r.trial.card.groups).toContain("pancreatic");
    expect(r.trial.card.siteCount).toBe(1);
    expect(r.trial.card.states).toEqual(["MD"]);
  });
  it("treats a completed-only U.S. site as unusable, and a recruiting U.S. site as real", () => {
    const done = toTrecTrial(rawStudy([{ facility: "MD Anderson", city: "Houston", state: "Texas", country: "United States", status: "COMPLETED" }]));
    expect(done.ok && done.trial.syntheticSite).toBe(true);
    const real = toTrecTrial(rawStudy([{ facility: "MD Anderson", city: "Houston", state: "Texas", zip: "77030", country: "United States", status: "RECRUITING" }]));
    expect(real.ok && !real.trial.syntheticSite).toBe(true);
    if (real.ok) expect(real.trial.card.states).toEqual(["TX"]);
  });
  it("reports schema failures and buildRecord drops without throwing", () => {
    expect(toTrecTrial({ protocolSection: { identificationModule: { nctId: "NCT00000001", briefTitle: "x" } } })).toMatchObject({ ok: false, id: "NCT00000001" });
    const notCancer = rawStudy([]);
    notCancer.protocolSection.identificationModule.briefTitle = "Exercise for Knee Osteoarthritis";
    notCancer.protocolSection.conditionsModule = { conditions: ["Osteoarthritis"] };
    notCancer.derivedSection = undefined;
    expect(toTrecTrial(notCancer)).toMatchObject({ ok: false, reason: "not a cancer trial" });
  });
});

describe("trecBm25Baseline", () => {
  it("ranks the card matching the topic text first", () => {
    const a = toTrecTrial(rawStudy([]));
    const b = toTrecTrial(rawStudy([]));
    if (!a.ok || !b.ok) throw new Error("fixture");
    b.trial.card.id = "NCT07654321";
    b.trial.card.title = "Trastuzumab for HER2-positive Breast Cancer";
    b.trial.card.conditions = ["Breast Cancer"];
    const ranked = trecBm25Baseline("A 70-year-old woman with pancreatic adenocarcinoma at the head of the pancreas", [b.trial.card, a.trial.card]);
    expect(ranked[0]).toBe("NCT01234567");
  });
});

describe("TREC file parsers", () => {
  it("parses qrels lines and rejects malformed ones", () => {
    const q = parseQrels("1 0 NCT00000001 2\n1 0 NCT00000002 0\n\n7 0 NCT00000003 1\n");
    expect(q.get(1)).toEqual({ NCT00000001: 2, NCT00000002: 0 });
    expect(q.get(7)).toEqual({ NCT00000003: 1 });
    expect(() => parseQrels("1 0 NCT1 2")).toThrow();
    expect(() => parseQrels("1 0 NCT00000001 3")).toThrow();
  });
  it("parses topics and decodes entities", () => {
    const t = parseTopicsXml('<topics task="x">\n<topic number="3">\r\nHe said &quot;hi&quot; &amp; left.  \r\nLine two\r\n</topic>\n</topics>');
    expect(t.get(3)).toBe('He said "hi" & left.\nLine two');
  });
});

describe("eval/trec/structured-answers.json", () => {
  const answers = JSON.parse(readFileSync("eval/trec/structured-answers.json", "utf8")) as Record<string, StructuredAnswers>;
  const topics = JSON.parse(readFileSync("eval/trec/topics-cancer.json", "utf8")) as { year: number; topicId: number; text: string }[];

  it("has one entry per cancer topic and vice versa", () => {
    expect(Object.keys(answers).sort()).toEqual(topics.map((t) => `${t.year}-${t.topicId}`).sort());
  });
  it("uses only option ids that exist in the group's catalog, honouring prerequisites", () => {
    const problems: string[] = [];
    for (const [key, a] of Object.entries(answers)) {
      expect(CANCER_GROUP_IDS).toContain(a.group);
      expect(Number.isInteger(a.age) && a.age >= 18).toBe(true);
      expect(typeof a.rationale).toBe("string");
      const catalog = getCatalog("cancer", a.group);
      const byId = new Map(catalog.map((q) => [q.id as string, q]));
      const all: Record<string, unknown> = { cancer_type: a.group, ...a };
      for (const [qid, val] of Object.entries(a)) {
        if (qid === "group" || qid === "age" || qid === "rationale") continue;
        const q = byId.get(qid);
        if (!q) {
          problems.push(`${key}: unknown question ${qid} for ${a.group}`);
          continue;
        }
        const ids = new Set((q.options ?? []).map((o) => o.id));
        if (q.type === "single" && (typeof val !== "string" || !ids.has(val))) problems.push(`${key}: ${qid} bad option ${JSON.stringify(val)}`);
        if (q.type === "multi" && (!Array.isArray(val) || val.length === 0 || val.some((x) => !ids.has(x)))) problems.push(`${key}: ${qid} bad options ${JSON.stringify(val)}`);
        if (q.type === "biomarker_grid") {
          const allowed = new Set<string>(q.biomarkers ?? []);
          if (typeof val !== "object" || val === null || Array.isArray(val)) problems.push(`${key}: ${qid} must be an object`);
          else for (const [m, s] of Object.entries(val)) if (!allowed.has(m) || !ids.has(s)) problems.push(`${key}: ${qid} bad grid entry ${m}=${s}`);
        }
        if (q.maxAge !== undefined && a.age > q.maxAge) problems.push(`${key}: ${qid} not asked above age ${q.maxAge}`);
        for (const p of q.prerequisites ?? []) {
          const pv = all[p.question];
          if (pv === undefined) continue; // unanswered prerequisite: question may still be asked
          const pids = typeof pv === "string" ? [pv] : Array.isArray(pv) ? (pv as string[]) : ["*"];
          const hit = p.anyOf.includes("*") || pids.some((x) => p.anyOf.includes(x));
          if (p.negate ? hit : !hit) problems.push(`${key}: ${qid} prerequisite on ${p.question} fails`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
