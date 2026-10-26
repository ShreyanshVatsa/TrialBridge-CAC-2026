import type { Assessment, FitLevel, MinimizedProfile, TrialAnalysis } from "@/lib/types/analysis";
import type { Language } from "@/lib/types/intake";
import { withEnglishFallback } from "@/lib/i18n/ai-language";
import type { CriterionRef } from "@/lib/types/trial";
import { precheck } from "@/lib/match/precheck";
import type { ServerTrial } from "../trials";
import type { AiProvider, CompletionRequest } from "./types";
import { mockAsk } from "./mock-ask";
import { mockMatch } from "./mock-match";

/**
 * Deterministic mock AI provider. Builds realistic structured analyses from the trial's REAL
 * criteria text and the rule-layer facts, so the full pipeline (including quote verification)
 * works with no API keys. Used when no provider is enabled, and always in tests.
 */

const EXPLAIN: Record<Language, Record<Assessment, string>> = withEnglishFallback({
  en: {
    likely_met: "Your answers suggest you may meet this requirement. Your care team can confirm.",
    likely_not_met: "Based on your answers, this might rule you out. Ask your care team to check.",
    needs_doctor: "Your answers don't tell us enough about this. Your doctor can check it with you.",
  },
  es: {
    likely_met: "Sus respuestas sugieren que podría cumplir este requisito. Su equipo médico puede confirmarlo.",
    likely_not_met: "Según sus respuestas, esto podría excluirle. Pida a su equipo médico que lo revise.",
    needs_doctor: "Sus respuestas no nos dicen lo suficiente sobre esto. Su médico puede revisarlo con usted.",
  },
  pt: {
    likely_met: "Suas respostas sugerem que você pode atender a este requisito. Sua equipe de saúde pode confirmar.",
    likely_not_met: "Com base nas suas respostas, isso pode excluir você. Peça à sua equipe de saúde para verificar.",
    needs_doctor: "Suas respostas não nos dizem o suficiente sobre isso. Seu médico pode verificar com você.",
  },
  ht: {
    likely_met: "Repons ou yo montre ou ka genyen kondisyon sa a. Ekip swen ou ka konfime sa.",
    likely_not_met: "Dapre repons ou yo, sa a ka anpeche ou patisipe. Mande ekip swen ou verifye sa.",
    needs_doctor: "Repons ou yo pa di nou ase sou sa. Doktè ou ka verifye sa avè ou.",
  },
});

const QUESTIONS: Record<Language, string[]> = withEnglishFallback({
  en: [
    "Could this trial be an option for me, given my diagnosis and treatment history?",
    "Do my latest test results meet this trial's requirements?",
    "How would joining this trial fit with my current care and travel?",
  ],
  es: [
    "¿Podría este estudio ser una opción para mí, según mi diagnóstico y mis tratamientos anteriores?",
    "¿Mis resultados de pruebas más recientes cumplen los requisitos de este estudio?",
    "¿Cómo encajaría este estudio con mi atención actual y los viajes necesarios?",
  ],
  pt: [
    "Este estudo poderia ser uma opção para mim, considerando meu diagnóstico e tratamentos anteriores?",
    "Meus resultados de exames mais recentes atendem aos requisitos deste estudo?",
    "Como participar deste estudo se encaixaria no meu tratamento atual e nas viagens necessárias?",
  ],
  ht: [
    "Èske etid sa a ka yon opsyon pou mwen, dapre dyagnostik mwen ak tretman mwen te resevwa deja?",
    "Èske dènye rezilta tès mwen yo koresponn ak kondisyon etid sa a?",
    "Kijan patisipe nan etid sa a ta mache ak swen mwen ap resevwa kounye a ak vwayaj yo?",
  ],
});

const SUMMARY: Record<Language, Record<FitLevel, string>> = withEnglishFallback({
  en: {
    strong: "Several criteria line up with your answers; this is a possible match to discuss with your care team.",
    possible: "Nothing in your answers clearly rules this out; it may be worth discussing with your care team.",
    unlikely: "At least one criterion may not fit your answers; ask your care team before ruling it out.",
    unclear: "There is not enough information to tell; your care team can review the criteria with you.",
  },
  es: {
    strong: "Varios criterios coinciden con sus respuestas; es una posible opción para hablar con su equipo médico.",
    possible: "Nada en sus respuestas lo descarta claramente; podría valer la pena hablarlo con su equipo médico.",
    unlikely: "Al menos un criterio podría no coincidir con sus respuestas; consulte a su equipo médico antes de descartarlo.",
    unclear: "No hay suficiente información; su equipo médico puede revisar los criterios con usted.",
  },
  pt: {
    strong: "Vários critérios combinam com suas respostas; é uma possível opção para conversar com sua equipe de saúde.",
    possible: "Nada nas suas respostas exclui isso claramente; pode valer a pena conversar com sua equipe de saúde.",
    unlikely: "Pelo menos um critério pode não combinar com suas respostas; pergunte à sua equipe de saúde antes de descartar.",
    unclear: "Não há informação suficiente; sua equipe de saúde pode revisar os critérios com você.",
  },
  ht: {
    strong: "Plizyè kritè koresponn ak repons ou yo; sa a se yon opsyon posib pou pale ak ekip swen ou.",
    possible: "Pa gen anyen nan repons ou yo ki elimine sa a klèman; li ka vo lapenn pale ak ekip swen ou.",
    unlikely: "Omwen yon kritè ka pa koresponn ak repons ou yo; mande ekip swen ou anvan ou elimine li.",
    unclear: "Pa gen ase enfòmasyon; ekip swen ou ka revize kritè yo avè ou.",
  },
});

const MAX_CRITERIA = 5;
const MAX_QUOTE = 1500;

function criterionText(trial: ServerTrial, ref: CriterionRef): string | null {
  const list = ref.section === "inclusion" ? trial.inclusion : trial.exclusion;
  return list.find((c) => c.n === ref.n)?.text ?? null;
}

function mockAnalyzeTrial(profile: MinimizedProfile, trial: ServerTrial): TrialAnalysis {
  const lang = profile.language;
  const notes = precheck(
    { spread: profile.spread, treatments: profile.treatments, biomarkers: profile.biomarkers, pregnant: profile.pregnant, inAnotherTrial: profile.concurrentTrial },
    trial.facts,
  );
  const criteria: TrialAnalysis["criteria"] = [];
  const used = new Set<string>();
  const add = (ref: CriterionRef, assessment: Assessment) => {
    const key = `${ref.section}:${ref.n}`;
    const text = criterionText(trial, ref);
    if (!text || used.has(key) || criteria.length >= MAX_CRITERIA) return;
    used.add(key);
    criteria.push({ section: ref.section, number: ref.n, quote: text.slice(0, MAX_QUOTE), assessment, explanation: EXPLAIN[lang][assessment] });
  };

  // Conflicts first (most important to surface), then supports, then open questions.
  for (const n of notes.filter((x) => x.kind === "conflict")) add(n.ref, "likely_not_met");
  for (const n of notes.filter((x) => x.kind === "support")) add(n.ref, "likely_met");
  const firstInclusion = trial.inclusion[0];
  if (firstInclusion) add({ section: "inclusion", n: firstInclusion.n }, "needs_doctor");
  for (const f of trial.facts) if (f.value !== "mentioned") add(f.ref, "needs_doctor");

  const conflicts = notes.filter((n) => n.kind === "conflict").length;
  const supports = notes.filter((n) => n.kind === "support").length;
  const fitLevel: FitLevel =
    trial.inclusion.length + trial.exclusion.length === 0 ? "unclear" : conflicts > 0 ? "unlikely" : supports > 0 ? "strong" : trial.facts.length > 0 ? "possible" : "unclear";

  return { nctId: trial.id, fitLevel, criteria, doctorQuestions: QUESTIONS[lang], summary: SUMMARY[lang][fitLevel] };
}

export const mockProvider: AiProvider = {
  name: "mock",
  isMock: true,
  maxInputChars: Number.POSITIVE_INFINITY,
  async complete(req: CompletionRequest): Promise<string> {
    if (req.match) return JSON.stringify(mockMatch(req.match.trials));
    const trial = req.trials[0];
    if (req.ask && trial) return JSON.stringify(mockAsk(trial, req.ask.question, req.ask.language));
    const profile = req.profile;
    if (!profile) throw new Error("mock provider: missing profile");
    return JSON.stringify({ trials: req.trials.map((t) => mockAnalyzeTrial(profile, t)) });
  },
};
