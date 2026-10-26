import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultCard } from "@/components/results/result-card";
import type { TrialMatchView } from "@/components/results/match-checklist";
import { en } from "@/components/i18n/en";
import type { RankedTrial, TrialMatchScore } from "@/lib/types";
import { makeCard } from "./fixtures";

const FAIL = "Known oncogenic driver alteration other than EGFR";
const card = makeCard({
  inclusion: [{ n: 1, text: "Histologically confirmed breast cancer" }],
  exclusion: [{ n: 1, text: FAIL }],
  criteria: [
    { id: "I1", section: "inclusion", text: "Histologically confirmed breast cancer" },
    { id: "E1", section: "exclusion", text: FAIL },
  ],
});

const trial: RankedTrial = {
  card,
  sites: [],
  nearest: null,
  languageWarning: false,
  precheck: [],
  scores: { keywordRank: 1, vectorRank: 1, rrf: 0.1, retrieval: 1, precheckPenalty: 0, fit: "possible", final: 1 },
  analysis: {
    nctId: card.id,
    fitLevel: "possible",
    summary: "Nothing in your answers clearly rules this out; it may be worth discussing with your care team.",
    doctorQuestions: [],
    criteria: [
      { section: "inclusion", number: 1, quote: "Histologically confirmed breast cancer", assessment: "likely_met", explanation: "You said breast cancer." },
      { section: "exclusion", number: 1, quote: FAIL, assessment: "needs_doctor", explanation: "Ask about other driver changes." },
    ],
  },
};

function view(tier: "A" | "B"): TrialMatchView {
  const fail = { id: "E1", section: "exclusion" as const, label: "excluded" as const, source: "llm" as const, reason: "Your answers mention a driver change." };
  const score: TrialMatchScore = {
    trialId: card.id,
    incScore: 1,
    tier,
    hardFailures: tier === "B" ? [fail] : [],
    counts: { met: 1, notMet: 0, excluded: tier === "B" ? 1 : 0, notExcluded: 0, unknown: 0, notApplicable: 0 },
    retrievalRank: 1,
    degraded: false,
  };
  return { score, labels: tier === "B" ? [{ id: "I1", section: "inclusion", label: "met", source: "rule" }, fail] : [{ id: "I1", section: "inclusion", label: "met", source: "rule" }] };
}

const count = (s: string, sub: string) => s.split(sub).length - 1;

describe("ResultCard tier wording", () => {
  it("tier A keeps the possible-match chip and the AI summary", () => {
    const out = renderToStaticMarkup(<ResultCard trial={trial} index={0} match={view("A")} />);
    expect(out).toContain(en.card.fit.possible);
    expect(out).toContain("Nothing in your answers clearly rules this out");
    expect(out).not.toContain(en.match.tierBBadge);
  });
  it("tier B replaces the chip and summary and shows the failing requirement once", () => {
    const out = renderToStaticMarkup(<ResultCard trial={trial} index={8} match={view("B")} />);
    expect(out).toContain(en.match.tierBBadge);
    expect(out).toContain(`href="#trial-${card.id}-hard"`);
    expect(out).toContain(`id="trial-${card.id}-hard"`);
    expect(out).toContain(en.match.tierBSummary);
    expect(out).not.toContain(en.card.fit.possible);
    expect(out).not.toContain("clearly rules this out");
    expect(out).not.toContain(en.card.needsDoctor);
    expect(count(out, FAIL)).toBe(2); // hard-failure note + the collapsed checklist row
    expect(out).toContain(en.card.whyFit);
    expect(out).not.toMatch(/\beligible\b/i);
  });
});

describe("ResultCard tier A with a pre-check conflict the checklist could not settle (QA: 'might rule you out' beside ✗ 0)", () => {
  it("lists it under 'Your doctor can help check', not 'What might rule you out'", () => {
    const noAi: RankedTrial = {
      ...trial,
      analysis: null,
      precheck: [{ key: "biomarker:HER2", kind: "conflict", quote: "HER2-negative breast cancer", ref: { section: "inclusion", n: 1 }, value: "required", source: "rule" }],
    };
    const out = renderToStaticMarkup(<ResultCard trial={noAi} index={0} match={view("A")} />);
    expect(out).not.toContain(en.card.ruleOut);
    expect(out).toContain(en.card.needsDoctor);
    expect(out).toContain("HER2-negative breast cancer");
    // without the checklist the older wording is unchanged
    expect(renderToStaticMarkup(<ResultCard trial={noAi} index={0} />)).toContain(en.card.ruleOut);
    // the same holds when an AI/mock analysis flags the requirement as likely not met
    const withAi: RankedTrial = { ...trial, analysis: { ...trial.analysis!, criteria: [{ section: "inclusion", number: 1, quote: "HER2-negative breast cancer", assessment: "likely_not_met", explanation: "This might rule you out." }] } };
    const out2 = renderToStaticMarkup(<ResultCard trial={withAi} index={0} match={view("A")} />);
    expect(out2).not.toContain(en.card.ruleOut);
    expect(out2).toContain("HER2-negative breast cancer");
  });
});
