import { describe, expect, it } from "vitest";
import { clauses, EXCERPT_MAX, focusQuote } from "@/lib/match/quote-focus";

const LONG =
  "* Patients with persistent disease and local recurrence must not be amenable to local treatment. * For patients with metastatic disease, late-stage MBC with no meaningful alternative therapies available and the following class specific treatment histories: 1. Human epidermal growth factor 2 (HER2) positive must be previously treated with at least 3 regimens containing at least two anti-HER2 agents. 2. Estrogen receptor (ER), progesterone receptor (PR) positive tumors: must be refractory to hormonal therapy. 3. Patients with new or progressive breast cancer metastatic to the brain will be eligible provided the brain metastases are clinically stable for at least 4 weeks prior to first dose and there is no need for steroids.";

describe("focusQuote", () => {
  it("keeps short quotes whole", () => {
    expect(focusQuote("ECOG performance status of 0, 1 or 2")).toEqual({ text: "ECOG performance status of 0, 1 or 2", partial: false });
  });
  it("picks the clause naming the fact and never exceeds the cap plus ellipses", () => {
    const brain = focusQuote(LONG, "brain_mets");
    expect(brain.partial).toBe(true);
    expect(brain.text).toMatch(/brain/);
    expect(brain.text.length).toBeLessThanOrEqual(EXCERPT_MAX + 3);
    expect(brain.text.startsWith("… ")).toBe(true);
    expect(focusQuote(LONG, "biomarker:her2").text).toMatch(/HER2/);
    expect(focusQuote(LONG, "biomarker:hr").text).toMatch(/Estrogen receptor/);
  });
  it("falls back to the first clause for unknown or missing keys", () => {
    const first = focusQuote(LONG);
    expect(first.text.startsWith("Patients with persistent disease")).toBe(true);
    expect(focusQuote(LONG, "zz").text).toBe(first.text);
    expect(focusQuote(LONG, "biomarker:kras").text).toBe(first.text);
  });
  it("clips one very long clause at a word boundary", () => {
    const one = `${"word ".repeat(80)}end`;
    const out = focusQuote(one);
    expect(out.text.endsWith("…")).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(EXCERPT_MAX + 1);
    expect(focusQuote("x".repeat(400)).text.length).toBe(EXCERPT_MAX + 1);
  });
  it("splits bullets, sentences and numbered items", () => {
    expect(clauses("* A one. * B two; C three\n4. Delta")).toEqual(["A one.", "B two;", "C three", "4. Delta"]);
  });
});
