import type { Language } from "@/lib/types/intake";
import type { RefusalReason } from "@/lib/types/ask";
import { withEnglishFallback } from "@/lib/i18n/ai-language";
import { matchesCrisis, normalizeForCrisis } from "@/lib/safety/crisis";

/**
 * Deterministic safety pre-checks for Trial Q&A (run before any AI call), in all four languages.
 * Crisis always wins. Eligibility/diagnosis/treatment-advice requests are politely refused.
 */
/** Lowercase and fold diacritics so accented and unaccented spellings match the same pattern. */
export const normalizeForSafety = normalizeForCrisis;

const REFUSALS: [RefusalReason, RegExp[]][] = [
  [
    "eligibility",
    [
      /\b(am i|would i be|i'?m|is my (mom|dad|wife|husband|mother|father)) (eligible|qualified)\b/i,
      /\b(do|would|will) (i|we) qualify\b/i,
      /\bcan (i|we) (join|enroll|participate|sign up|get in)\b/i,
      /\bshould (i|we) (join|enroll|participate|sign up)\b/i,
      /\bam i a (good )?(candidate|fit|match)\b/i,
      /\b(will|would) (i|they) (accept|take) me\b/i,
      /soy elegible|califico|¿?puedo (participar|inscribirme|unirme|entrar)/i,
      /sou eleg[ií]vel|me qualifico|posso participar|posso entrar/i,
      /mwen kalifye|mwen ka patisipe|eske mwen ka antre/i,
    ],
  ],
  [
    "diagnosis",
    [
      /\b(do|could|might) i have (cancer|a tumou?r|leukemia|lymphoma)\b/i,
      /\bwhat stage (am i|is my|do i)\b/i,
      /\bis my (cancer|tumou?r|lump)\b/i,
      /\bmy (scan|biopsy|test|lab|blood work|mri|ct|pet)( results?)? (shows?|says?|mean)/i,
      /\bwhat does my (scan|biopsy|test|result|report)/i,
      /\b(am i|i'?m) dying\b|\bhow long do i have\b/i,
      /tengo c[aá]ncer|qu[eé] etapa tengo|tenho c[aâ]ncer|qual ([eé] )?(o )?meu est[aá]gio|mwen gen kansè/i,
    ],
  ],
  [
    "treatment_advice",
    [
      /\bshould i (take|stop|start|get|try|do|have|choose|skip|refuse)\b/i,
      /\bwhat (treatment|medicine|medication|drug|therapy) should\b/i,
      /\bwhich (treatment|option|therapy) is (best|better|right) for me\b/i,
      /\bis (this|it) (the )?(best|better|right) (treatment |option )?for me\b/i,
      /\b(recommend|suggest) (a |any )?(treatment|medicine|drug|therapy)\b/i,
      /debo (tomar|dejar|empezar)|qu[eé] tratamiento (debo|me recomienda)|devo (tomar|parar|come[cç]ar)|qual tratamento (devo|me recomenda)|kisa m ta dwe pran/i,
    ],
  ],
];

/** Crisis detection: every locale's lexicon (lib/safety/lexicons) runs, whatever the request language. */
export function detectCrisis(question: string): boolean {
  return matchesCrisis(question);
}

export function detectRefusal(question: string): RefusalReason | null {
  for (const [reason, patterns] of REFUSALS) if (patterns.some((re) => re.test(question))) return reason;
  return null;
}

/**
 * Deterministic post-filter for model-written text: it must never tell a person they are (not)
 * eligible/qualified, or advise a treatment. Prompts forbid it; this enforces it on the output.
 */
const BANNED_OUTPUT = [
  /\b(you|you're|you are|you'll|you would|you will|you may|you might|you could)\s+(also\s+|likely\s+|probably\s+|definitely\s+)?(be\s+)?(eligible|qualified|ineligible|a (good |strong )?(candidate|match|fit))\b/i,
  /\byou\s+(?:(?:do|does|would|wouldn'?t|will|won'?t|likely|probably|might|may|could|can|can'?t|cannot|not|don'?t)\s+)*qualify\b/i,
  /\byou should (take|stop|start|try|choose|skip|avoid|switch|refuse|get|have)\b|\bi (recommend|advise|suggest) (that )?you\b/i,
  /\b(usted|ud\.?) (es elegible|califica|no califica)\b|\b(es|eres) elegible\b|\busted debe (tomar|dejar|empezar)\b/i,
  /\bvoc[eê] ([eé] eleg[ií]vel|se qualifica|n[aã]o se qualifica|deve (tomar|parar|come[cç]ar))\b/i,
  /\bou (kalifye|pa kalifye|elijib)\b/i,
];
export function violatesWording(text: string): boolean {
  const t = text.replace(/[\u2018\u2019]/g, "'");
  // Model text never needs links; one injected through trial text or a question could be phishing.
  if (/\b(?:https?|ftp):\/\/|\bwww\.|\bjavascript:|\bdata:text/i.test(t)) return true;
  return BANNED_OUTPUT.some((re) => re.test(t));
}

export const NEUTRAL_NOTE: Record<Language, string> = withEnglishFallback({
  en: "Please discuss this with your care team and the trial contact.",
  es: "Hable de esto con su equipo médico y con el contacto del estudio.",
  pt: "Converse sobre isso com sua equipe de saúde e com o contato do estudo.",
  ht: "Tanpri pale sou sa ak ekip swen ou ak kontak etid la.",
});

type Msg = "crisis" | RefusalReason | "not_in_text" | "answer_intro";
/** Languages without server-written text (the machine-translated ones) get the English reply; the UI shows its own localized crisis line. */
export const SAFE_REPLIES: Record<Language, Record<Msg, string>> = withEnglishFallback({
  en: {
    crisis:
      "I'm really sorry you're going through this. You don't have to face it alone. In the U.S., you can call or text 988 to reach the Suicide & Crisis Lifeline, any time. If you are in immediate danger, call 911. Please also tell your care team how you are feeling.",
    eligibility: "I can't tell whether this trial is a match for you. Only the trial team and your doctor can decide that. I can explain what a specific requirement says, so try asking about one.",
    diagnosis: "I can't interpret a diagnosis, stage, or test results. Your care team knows your full history and is the best place to ask.",
    treatment_advice: "I can't recommend treatments. Your care team can help you weigh your options, including whether this trial is worth discussing.",
    off_topic: "I can only answer questions about this trial's official information. Try asking about who can join, what is being tested, or the study requirements.",
    not_in_text: "The official trial information doesn't answer this. The trial contact listed on this page can help.",
    answer_intro: "Here is what the official trial text says:",
  },
  es: {
    crisis:
      "Siento mucho que esté pasando por esto. No tiene que enfrentarlo solo. En EE. UU., puede llamar o enviar un mensaje de texto al 988 para comunicarse con la Línea de Prevención del Suicidio y Crisis, a cualquier hora. Si está en peligro inmediato, llame al 911. Cuéntele también a su equipo médico cómo se siente.",
    eligibility: "No puedo decir si este estudio es una opción adecuada para usted. Solo el equipo del estudio y su médico pueden decidirlo. Puedo explicar lo que dice un requisito específico; pregunte por uno.",
    diagnosis: "No puedo interpretar un diagnóstico, una etapa ni resultados de pruebas. Su equipo médico conoce su historial completo y es el mejor lugar para preguntar.",
    treatment_advice: "No puedo recomendar tratamientos. Su equipo médico puede ayudarle a evaluar sus opciones, incluido si vale la pena hablar de este estudio.",
    off_topic: "Solo puedo responder preguntas sobre la información oficial de este estudio. Pregunte quién puede participar, qué se está probando o cuáles son los requisitos.",
    not_in_text: "La información oficial del estudio no responde a esto. El contacto del estudio que aparece en esta página puede ayudarle.",
    answer_intro: "Esto es lo que dice el texto oficial del estudio (en inglés):",
  },
  pt: {
    crisis:
      "Sinto muito que você esteja passando por isso. Você não precisa enfrentar isso sozinho. Nos EUA, ligue ou envie uma mensagem de texto para 988 para falar com a Linha de Prevenção ao Suicídio e Crise, a qualquer hora. Se estiver em perigo imediato, ligue para 911. Conte também à sua equipe de saúde como você está se sentindo.",
    eligibility: "Não posso dizer se este estudo é uma boa opção para você. Somente a equipe do estudo e seu médico podem decidir isso. Posso explicar o que diz um requisito específico; pergunte sobre um.",
    diagnosis: "Não posso interpretar diagnósticos, estágios ou resultados de exames. Sua equipe de saúde conhece todo o seu histórico e é o melhor lugar para perguntar.",
    treatment_advice: "Não posso recomendar tratamentos. Sua equipe de saúde pode ajudar você a avaliar suas opções, inclusive se vale a pena conversar sobre este estudo.",
    off_topic: "Só posso responder perguntas sobre as informações oficiais deste estudo. Pergunte quem pode participar, o que está sendo testado ou quais são os requisitos.",
    not_in_text: "As informações oficiais do estudo não respondem a isso. O contato do estudo listado nesta página pode ajudar.",
    answer_intro: "Veja o que diz o texto oficial do estudo (em inglês):",
  },
  ht: {
    crisis:
      "Mwen regrèt anpil ou ap pase sa a. Ou pa oblije fè fas ak li pou kont ou. Ozetazini, ou ka rele oswa voye tèks bay 988 pou jwenn Liy Sekou pou Swisid ak Kriz la, nenpòt lè. Si ou an danje kounye a, rele 911. Tanpri di ekip swen ou tou kijan ou santi ou.",
    eligibility: "Mwen pa ka di si etid sa a se yon bon chwa pou ou. Se sèlman ekip etid la ak doktè ou ki ka deside sa. Mwen ka eksplike sa yon kondisyon espesifik di; poze kesyon sou youn.",
    diagnosis: "Mwen pa ka entèprete yon dyagnostik, yon etap, oswa rezilta tès. Ekip swen ou konnen tout istwa ou e se pi bon kote pou mande.",
    treatment_advice: "Mwen pa ka rekòmande tretman. Ekip swen ou ka ede ou konsidere opsyon ou yo, enkli si li vo lapenn pale sou etid sa a.",
    off_topic: "Mwen ka reponn sèlman kesyon sou enfòmasyon ofisyèl etid sa a. Mande kiyès ki ka patisipe, kisa y ap teste, oswa ki kondisyon yo.",
    not_in_text: "Enfòmasyon ofisyèl etid la pa reponn sa. Kontak etid ki sou paj sa a ka ede ou.",
    answer_intro: "Men sa tèks ofisyèl etid la di (an anglè):",
  },
});
