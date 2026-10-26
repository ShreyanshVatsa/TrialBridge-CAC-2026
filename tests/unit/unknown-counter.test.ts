import { describe, expect, it } from "vitest";
import { unknownCounter } from "@/lib/match/precheck";
import type { CompiledAnswer } from "@/lib/questionnaire/rules";
import type { Fact } from "@/lib/types/trial";

const fact = (key: string, value: Fact["value"], extra: Partial<Fact> = {}): Fact => ({ key: key as Fact["key"], value, quote: "q", ref: { section: "inclusion", n: 1 }, source: "rule", ...extra });
const answered = (key: string): CompiledAnswer => ({ question: "q", rules: new Map([[key, [{ rule: { fact: key as Fact["key"] }, inverted: false }]]]), hardFilter: null, queryTerms: [] });

describe("unknownCounter", () => {
  const facts = [fact("metastatic", "required"), fact("ecog_max", "required"), fact("hiv", "excluded"), fact("prior_surgery", "mentioned"), fact("brain_mets", "excluded", { needsReview: true })];
  it("counts directional criteria no answer speaks to", () => {
    expect(unknownCounter([])(facts)).toBe(3);
    expect(unknownCounter([answered("metastatic")])(facts)).toBe(2);
  });
  it("a non-response compiles to no rules, so it adds unknowns and never removes them", () => {
    const none: CompiledAnswer = { question: "q", rules: new Map(), hardFilter: null, queryTerms: [] };
    expect(unknownCounter([none])(facts)).toBe(3);
  });
});
