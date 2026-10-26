import type { Citation, AskKind, RefusalReason } from "@/lib/types/ask";
import type { Language } from "@/lib/types/intake";
import { sentences } from "@/lib/ingest/barriers";
import { SAFE_REPLIES } from "../safety";
import type { ServerTrial } from "../trials";

/**
 * Deterministic mock Q&A: keyword overlap between the question and the trial's own text.
 * Answers only by quoting matching passages; otherwise "not in text" or "off topic".
 */
const STOP = new Set(
  "the a an and or of to in on for with is are was were be been this that these those what which who whom how when where why do does did can could would should will i me my we you your it its there their they them at by from as about into than then if not no any all have has had trial study".split(" "),
);
/** Words that make a question plausibly about a clinical trial (any of the 4 languages). */
const DOMAIN =
  /\b(trial|study|criteri|requirement|include|exclude|inclusion|exclusion|join|participat|enrol|phase|drug|medic|treat|therap|dose|side effect|placebo|random|chemo|radiat|surg|metasta|stage|cancer|tumou?r|age|old|pregnan|breastfeed|biops|scan|test|visit|cost|pay|insur|sponsor|long|duration|how many|ensayo|estudio|estudo|criterio|crit[eé]rio|edad|idade|embaraz|gr[aá]vida|tratamiento|tratamento|medicamento|etid|tretman|laj)/i;

/** Crude stemmer so singular/plural pairs meet: metastasis/metastases, therapy/therapies, disease/diseases. */
export function stem(word: string): string {
  let w = word.toLowerCase();
  if (/[^s]sis$/.test(w) || /[^s]ses$/.test(w)) w = w.slice(0, -2);
  else if (/ies$/.test(w) && w.length > 4) w = `${w.slice(0, -3)}y`;
  else w = w.replace(/(es|s|ing|ed)$/, "");
  return w.length > 3 ? w.replace(/e$/, "") : w;
}
function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9áéíóúñãõâêôçè-]+/i)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map(stem),
  );
}

interface Passage {
  citation: Citation;
  terms: Set<string>;
}

function passages(t: ServerTrial): Passage[] {
  const out: Passage[] = [{ citation: { section: "title", number: null, quote: t.title }, terms: terms(t.title) }];
  for (const s of sentences(t.summary)) out.push({ citation: { section: "summary", number: null, quote: s.slice(0, 1500) }, terms: terms(s) });
  for (const c of t.inclusion) out.push({ citation: { section: "inclusion", number: c.n, quote: c.text.slice(0, 1500) }, terms: terms(c.text) });
  for (const c of t.exclusion) out.push({ citation: { section: "exclusion", number: c.n, quote: c.text.slice(0, 1500) }, terms: terms(c.text) });
  return out;
}

export interface AskModelOutput {
  kind: Exclude<AskKind, "crisis">;
  refusalReason: RefusalReason | null;
  answer: string;
  citations: Citation[];
}

export function mockAsk(trial: ServerTrial, question: string, language: Language): AskModelOutput {
  const q = terms(question);
  const scored = passages(trial)
    .map((p) => ({ p, hits: [...q].filter((w) => p.terms.has(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const best = scored[0];
  const trialVocab = scored.length > 0;
  if (!best || best.hits < Math.min(2, q.size)) {
    if (!DOMAIN.test(question) && !trialVocab) return { kind: "refusal", refusalReason: "off_topic", answer: SAFE_REPLIES[language].off_topic, citations: [] };
    return { kind: "not_in_text", refusalReason: null, answer: SAFE_REPLIES[language].not_in_text, citations: [] };
  }
  const top = scored.filter((x) => x.hits >= best.hits).slice(0, 2).map((x) => x.p.citation);
  const label = (c: Citation) => (c.section === "inclusion" ? `Inclusion criterion ${c.number}` : c.section === "exclusion" ? `Exclusion criterion ${c.number}` : c.section === "summary" ? "Summary" : "Title");
  const body = top.map((c) => `“${c.quote}” (${label(c)})`).join(" ");
  return { kind: "answer", refusalReason: null, answer: `${SAFE_REPLIES[language].answer_intro} ${body}`, citations: top };
}
