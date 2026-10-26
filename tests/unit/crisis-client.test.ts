import { afterEach, describe, expect, it, vi } from "vitest";
import { detectCrisisLocal, localCrisisResponse } from "@/lib/api/crisis";
import { askQuestion, questionsRemaining, resetQuestionCountsForTests } from "@/lib/api/ask";
import { AskResponseSchema } from "@/lib/types/ask";

afterEach(() => {
  vi.unstubAllGlobals();
  resetQuestionCountsForTests();
});

describe("client crisis detector (no network)", () => {
  const crisis = [
    // English
    "I am thinking about ending my life",
    "I want to take my own life",
    "I wish I were dead",
    "I don't want to be here anymore",
    "I don’t want to live anymore",
    "what's the point of living",
    "I might overdose",
    "I want to kill myself",
    "I'm suicidal",
    // Portuguese (accented and plain)
    "Estou pensando em suicídio",
    "estou pensando em suicidio",
    "quero acabar com a minha vida",
    "Eu quero morrer",
    "não quero mais viver",
    // Spanish
    "quiero acabar con mi vida",
    "Quiero quitarme la vida",
    "Pienso en el suicidio",
    "no quiero seguir viviendo",
    // Haitian Creole (accented and plain)
    "mwen ap panse swisid",
    "Mwen vle touye tèt mwen",
    "mwen vle touye tet mwen",
    "mwen pa vle viv ankò",
    "mwen vle mouri",
  ];
  it.each(crisis)("detects: %s", (text) => {
    expect(detectCrisisLocal(text)).toBe(true);
  });

  const normal = [
    "Can people who had radiation before join?",
    "Do I need to be fasting before the blood draw?",
    "Is parking free at the site?",
    "Posso participar se já fiz quimioterapia?",
    "¿Puedo participar si tomo medicamentos para la presión?",
    "Eske m ka patisipe si m te fè chirijri?",
    "What is the end date of this study?",
    "How long is the trial life cycle?",
  ];
  it.each(normal)("does not flag: %s", (text) => {
    expect(detectCrisisLocal(text)).toBe(false);
  });

  it("returns a schema-valid response that shows crisis resources", () => {
    const r = localCrisisResponse();
    expect(AskResponseSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ kind: "crisis", crisis: true, status: "ok" });
  });

  it("askQuestion answers a crisis locally: no network call, no question used, works while offline", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", f);
    const r = await askQuestion("NCT00000001", "quero acabar com a minha vida", "pt", "token");
    expect(r.crisis).toBe(true);
    expect(f).not.toHaveBeenCalled();
    expect(questionsRemaining("NCT00000001")).toBe(10);
  });
});

describe("question counter", () => {
  const ok = { status: "ok", kind: "answer", answer: "a", citations: [], crisis: false, piiRemoved: false, experimental: false, cached: false, provider: "mock" };
  it("is only used by answered questions; failed and degraded requests are free", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    await askQuestion("NCT00000001", "Is there a placebo?", "en", "t");
    expect(questionsRemaining("NCT00000001")).toBe(10);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("offline");
    }));
    await askQuestion("NCT00000001", "Is there a placebo?", "en", "t");
    expect(questionsRemaining("NCT00000001")).toBe(10);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...ok, status: "degraded", kind: null, answer: "", degradedReason: "ai_unavailable" }))));
    await askQuestion("NCT00000001", "Is there a placebo?", "en", "t");
    expect(questionsRemaining("NCT00000001")).toBe(10);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ok))));
    await askQuestion("NCT00000001", "Is there a placebo?", "en", "t");
    expect(questionsRemaining("NCT00000001")).toBe(9);
  });
});
