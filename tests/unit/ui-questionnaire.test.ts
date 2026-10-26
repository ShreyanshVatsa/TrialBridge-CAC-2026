import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/components/i18n/en";
import { answerText } from "@/components/questionnaire/answer-text";
import { emptyState, isNonResponse, nonResponseKind, type QuestionDef, type QuestionnaireState } from "@/components/questionnaire/contract";
import { FindOutList } from "@/components/questionnaire/find-out-list";
import { QuestionCard } from "@/components/questionnaire/question-card";
import type { KeyT } from "@/components/questionnaire/t";

const UI_DIRS = ["components/questionnaire", "components/results", "components/find"];

function files(dir: string): string[] {
  return readdirSync(dir).filter((f) => /\.(tsx?)$/.test(f)).map((f) => path.join(dir, f));
}

function resolve(key: string): string | undefined {
  let cur: unknown = en;
  for (const part of key.split(".")) cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
  return typeof cur === "string" ? cur : undefined;
}
const t = Object.assign((key: string, vars?: Record<string, string | number>) => {
  const raw = (vars && typeof vars.count === "number" ? resolve(`${key}.${vars.count === 1 ? "one" : "other"}`) : undefined) ?? resolve(key) ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (vars && k in vars ? String(vars[k]) : m));
}, { has: (k: string) => resolve(k) !== undefined, locale: "en-US" }) as KeyT;

const q = (over: Partial<QuestionDef>): QuestionDef =>
  ({
    id: "spread",
    area: "cancer",
    tier: "helpful",
    type: "single",
    labelKey: "chat.spreadQ",
    helpKey: "questionnaire.ui.nonResponseHint",
    whyKey: "questionnaire.ui.modeNote",
    appliesTo: "all",
    cost: 1,
    enabled: true,
    effects: [],
    evidence: "",
    families: [],
    options: [
      { id: "yes", labelKey: "options.spread.yes" },
      { id: "no", labelKey: "options.spread.no" },
      { id: "unknown", labelKey: "options.spread.not_sure" },
    ],
    ...over,
  }) as unknown as QuestionDef;

const state = (answers: QuestionnaireState["answers"], deferred: string[] = []): QuestionnaireState => ({ ...emptyState(), answers, deferred, history: Object.keys(answers) });

describe("non-response helpers", () => {
  it("treats unknown, skip, prefer-not and deferred (null) the same", () => {
    for (const v of ["unknown", "__skip", "prefer_not", null, ["unknown"]] as const) expect(isNonResponse(v as never)).toBe(true);
    for (const v of ["yes", ["chemotherapy"], 52, { HER2: "positive" }] as const) expect(isNonResponse(v as never)).toBe(false);
  });
  it("names the kind for display", () => {
    expect(nonResponseKind(state({ a: "unknown" }), "a")).toBe("unknown");
    expect(nonResponseKind(state({ a: "__skip" }), "a")).toBe("skip");
    expect(nonResponseKind(state({ a: "prefer_not" }), "a")).toBe("prefer_not");
    expect(nonResponseKind(state({ a: null }, ["a"]), "a")).toBe("deferred");
    expect(nonResponseKind(state({ a: "yes" }), "a")).toBeNull();
  });
});

describe("answerText", () => {
  it("renders each answer type in plain language", () => {
    expect(answerText(q({}), state({ spread: "yes" }), t, en as never)).toBe("Yes");
    expect(answerText(q({}), state({ spread: "unknown" }), t, en as never)).toBe("Not sure");
    expect(answerText(q({}), state({ spread: "__skip" }), t, en as never)).toBe("Skipped");
    expect(answerText(q({}), state({ spread: null }, ["spread"]), t, en as never)).toBe("Waiting for your doctor");
    const multi = q({ id: "treatments", type: "multi", options: [{ id: "chemotherapy", labelKey: "options.treatment.chemotherapy" }, { id: "radiation", labelKey: "options.treatment.radiation" }] as never });
    expect(answerText(multi, state({ treatments: ["chemotherapy", "radiation"] }), t, en as never)).toBe("Chemotherapy, Radiation");
    const grid = q({ id: "biomarkers", type: "biomarker_grid", biomarkers: ["HER2", "HR"] as never, options: undefined });
    expect(answerText(grid, state({ biomarkers: { HER2: "positive", HR: "unknown" } }), t, en as never)).toBe("HER2: Positive");
    expect(answerText(grid, state({ biomarkers: { HER2: "unknown" } }), t, en as never)).toBe("Don't know");
    const travel = q({ id: "travel", type: "travel", options: undefined });
    expect(answerText(travel, state({ travel: null }), t, en as never)).toBe("Anywhere in the U.S.");
    expect(answerText(travel, state({ travel: 100 }), t, en as never)).toBe("Up to 100 miles");
  });
});

describe("QuestionCard markup", () => {
  const render = (def: QuestionDef) => renderToStaticMarkup(createElement(QuestionCard, { q: def, autoFocus: false, onAnswer: () => undefined, onBack: () => undefined }));

  it("is a fieldset with a legend, radios, why-we're-asking and equal non-response chips", () => {
    const html = render(q({}));
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain('type="radio"');
    expect(html).toContain("Why we&#x27;re asking");
    expect(html).toContain("Not sure");
    expect(html).toContain("Skip");
    expect(html).not.toContain("Prefer not to say");
    expect(html).not.toContain("My doctor can fill this in later");
    expect(html).toContain("Back");
    expect(html).toContain("Continue");
  });

  it("adds prefer-not on sensitive questions and doctor-later on cost-3 questions", () => {
    expect(render(q({ sensitive: true }))).toContain("Prefer not to say");
    expect(render(q({ cost: 3 }))).toContain("My doctor can fill this in later");
  });

  it("renders the biomarker grid as a list of labelled radio groups with an answered count", () => {
    const html = render(q({ id: "biomarkers", type: "biomarker_grid", biomarkers: ["HER2", "EGFR"] as never, options: undefined, cost: 3 }));
    expect(html).toContain("<ul");
    expect((html.match(/aria-labelledby=/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("0 of 2 answered");
    expect(html).not.toContain('type="search"'); // search only for long lists
    expect((html.match(/role="radiogroup"/g) ?? []).length).toBe(2);
    expect(html).toContain("Not tested");
    expect(html).toContain("I don&#x27;t know any of these");
  });

  it("shows the essential step, the what-is-this help and the number-key tip", () => {
    const html = render(q({ id: "spread" }));
    expect(html).toContain("What is this? Why we&#x27;re asking");
    expect(html).toContain("press a number from 1 to");
    const essential = renderToStaticMarkup(createElement(QuestionCard, { q: q({ id: "age", type: "age", tier: "essential", options: undefined }), autoFocus: false, onAnswer: () => undefined }));
    expect(essential).toContain("Question 2 of 4");
  });

  it("uses the caregiver wording variant when one exists", () => {
    const html = renderToStaticMarkup(createElement(QuestionCard, { q: q({ id: "age", type: "age", tier: "essential", labelKey: "questionnaire.age.label", options: undefined }), autoFocus: false, onAnswer: () => undefined, caregiver: true }));
    expect(html).toContain("How old are they?");
  });

  it("shows the impact hint only when an answer could narrow the set", () => {
    const withImpact = renderToStaticMarkup(createElement(QuestionCard, { q: q({}), autoFocus: false, onAnswer: () => undefined, impact: { total: 120, narrowedTo: 40 } }));
    expect(withImpact).toContain("could narrow 120 trials to about 40");
    const none = renderToStaticMarkup(createElement(QuestionCard, { q: q({}), autoFocus: false, onAnswer: () => undefined, impact: { total: 120, narrowedTo: null } }));
    expect(none).not.toContain("could narrow");
  });
});

describe("Find-out list", () => {
  it("renders what/where/why, a waiting badge and a print checklist box", () => {
    const html = renderToStaticMarkup(
      createElement(FindOutList, { entries: [{ question: "biomarkers", whatKey: "chat.biomarkersQ", whereKey: "results.findOutPrivate", whyKey: "questionnaire.ui.modeNote", deferred: true }] }),
    );
    expect(html).toContain("Find out at your next appointment");
    expect(html).toContain("Where to look");
    expect(html).toContain("Waiting for your doctor");
    expect(html).toContain("print-only");
  });
  it("renders nothing when empty", () => {
    expect(renderToStaticMarkup(createElement(FindOutList, { entries: [] }))).toBe("");
  });
});

describe("UI copy and code rules", () => {
  const copy = JSON.stringify({ q: en.questionnaire, r: Object.fromEntries(Object.entries(en.results).filter(([k]) => k.startsWith("findOut"))), p: en.privacy });

  it("never says eligible / qualify / you can join", () => {
    expect(copy).not.toMatch(/\beligib|\bqualif|you can join/i);
  });

  it("privacy copy describes tab-scoped storage honestly", () => {
    expect(en.privacy.browserBody).toMatch(/kept only in this browser tab until you close it/);
    expect(en.privacy.browserBody).not.toMatch(/disappears when you close or refresh/);
  });

  it("plural keys have one and other forms", () => {
    const ui = en.questionnaire.ui as Record<string, unknown>;
    for (const k of ["remaining", "counter", "dropped", "earlier", "moreOptional"]) expect(Object.keys(ui[k] as object).sort()).toEqual(["one", "other"]);
  });

  it("no dangerouslySetInnerHTML and no text smaller than 16px in questionnaire views", () => {
    for (const dir of UI_DIRS) {
      for (const f of files(dir)) {
        const src = readFileSync(f, "utf8");
        expect(src, f).not.toContain("dangerouslySetInnerHTML");
        if (dir === "components/questionnaire") expect(src, f).not.toMatch(/\btext-(xs|sm)\b/);
      }
    }
  });

  it("answers are stored only in sessionStorage (never localStorage or IndexedDB)", () => {
    for (const f of files("components/questionnaire")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/localStorage|indexedDB/);
    }
  });
});
