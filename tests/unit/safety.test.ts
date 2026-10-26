import { describe, expect, it } from "vitest";
import { detectCrisis, normalizeForSafety, SAFE_REPLIES } from "@/functions/lib/safety";

describe("crisis detection (H1)", () => {
  const positives = [
    "I am thinking about ending my life",
    "I want to take my own life",
    "I wish I were dead",
    "I don't want to be here anymore",
    "I dont want to be here anymore",
    "what's the point of living",
    "I might overdose",
    "I want to overdose on my pills",
    "everyone would be better off without me",
    "I'm going to kill myself",
    "I want to end it all",
    "Estou pensando em suicídio",
    "estou pensando em SUICIDIO",
    "quero acabar com a minha vida",
    "Não quero mais viver",
    "Estou pensando em me matar",
    "quiero acabar con mi vida",
    "Pienso en el suicidio",
    "no quiero seguir viviendo",
    "Quiero quitarme la vida",
    "mwen ap panse swisid",
    "mwen vle touye tèt mwen",
    "mwen pa vle viv ankò",
    "mwen vle mouri",
  ];
  for (const q of positives) it(`flags: ${q}`, () => expect(detectCrisis(q)).toBe(true));

  const negatives = [
    "Does the drug cause hair loss?",
    "What is the end of study date?",
    "Is the point of this trial to test dosing?",
    "Can I take my own medication during the trial?",
    "Quanto tempo dura o estudo?",
    "Cuántos años debo tener?",
    "Kisa etid la ap teste?",
  ];
  for (const q of negatives) it(`ignores: ${q}`, () => expect(detectCrisis(q)).toBe(false));

  it("normalizes accents and curly quotes", () => {
    expect(normalizeForSafety("Suicídio ’")).toBe("suicidio '");
  });
  it("refusal replies avoid banned wording", () => {
    for (const lang of ["en", "es", "pt", "ht"] as const) expect(SAFE_REPLIES[lang].eligibility).not.toMatch(/qualif|califica|kalifye/i);
  });
});

import { NEUTRAL_NOTE, violatesWording } from "@/functions/lib/safety";
import { sanitizeAnalysis } from "@/functions/lib/analyze";
describe("model output wording filter (L2)", () => {
  it("flags eligibility claims and treatment advice, allows neutral text", () => {
    for (const t of ["You are eligible for this trial.", "You would likely qualify.", "I recommend that you stop taking it.", "You should start chemotherapy.", "Usted califica para el estudio", "Você se qualifica", "Ou kalifye"]) expect(violatesWording(t)).toBe(true);
    for (const t of ["The eligibility criteria list age 18 or older.", "Participants must be at least 18 to be eligible for this study.", "Ask your care team whether this trial is a match."]) expect(violatesWording(t)).toBe(false);
  });
  it("sanitizes analysis text in the user's language", () => {
    const a = sanitizeAnalysis(
      { nctId: "NCT12345678", fitLevel: "possible", summary: "You are eligible!", doctorQuestions: ["Ask about dosing", "You should stop your medicine"], criteria: [{ section: "inclusion", number: 1, quote: "Age 18 or older", assessment: "likely_met", explanation: "You qualify." }] },
      "es",
    );
    expect(a.summary).toBe(NEUTRAL_NOTE.es);
    expect(a.doctorQuestions).toEqual(["Ask about dosing", NEUTRAL_NOTE.es]);
    expect(a.criteria[0]?.explanation).toBe(NEUTRAL_NOTE.es);
  });
});
