import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Quote } from "@/components/results/badges";
import { Disclaimer } from "@/components/site/disclaimer";
import { IntroPanel } from "@/components/questionnaire/intro-panel";
import { en } from "@/components/i18n/en";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => undefined;
/** Text as React writes it into markup (apostrophes and quotes escaped). */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LONG =
  "Inclusion criteria: 1. Histologically confirmed adenocarcinoma of the breast. 2. Measurable disease per RECIST 1.1 on imaging within 28 days before enrollment. " +
  "3. ECOG performance status of 0 or 1 at screening. 4. Adequate organ function, including absolute neutrophil count at least 1,500 per microliter, platelets at least 100,000 per microliter and hemoglobin at least 9 g/dL. " +
  "5. Women of childbearing potential must agree to use two forms of contraception during the study and for six months after the last dose.";

describe("Quote", () => {
  it("a short quote shows whole, with no disclosure", () => {
    const out = html(<Quote text="ECOG 0 or 1." focus="ecog_max" />);
    expect(out).toContain("ECOG 0 or 1.");
    expect(out).not.toContain("<details");
  });
  it("a long quote shows the clause carrying the fact, and the full text behind a disclosure", () => {
    const out = html(<Quote text={LONG} focus="ecog_max" criterionRef={{ section: "inclusion", n: 3 }} />);
    const shown = out.slice(0, out.indexOf("<figcaption"));
    expect(shown).toContain("ECOG performance status");
    expect(shown).not.toContain("contraception");
    expect(out).toContain(esc(en.card.showFull));
    expect(out).toContain("Inclusion criterion 3");
  });
  it("without focus the text is never cut", () => {
    expect(html(<Quote text={LONG} />)).not.toContain("<details");
  });
});

describe("Disclaimer", () => {
  it("full and compact forms both carry the not-medical-advice text and label", () => {
    for (const el of [<Disclaimer key="a" />, <Disclaimer key="b" compact />]) {
      const out = html(el);
      expect(out).toContain(esc(en.disclaimer.text));
      expect(out).toContain(`aria-label="${en.disclaimer.label}"`);
    }
    expect(html(<Disclaimer compact />)).not.toContain("rounded-2xl");
  });
});

describe("IntroPanel", () => {
  it("offers the sample patient next to the heading, before the reassurances and the caregiver switch", () => {
    const out = html(<IntroPanel caregiver={false} onCaregiver={noop} onSample={noop} />);
    const sample = out.indexOf(esc(en.questionnaire.ui.sampleButton));
    expect(sample).toBeGreaterThan(out.indexOf(esc(en.questionnaire.ui.introTitle)));
    expect(sample).toBeLessThan(out.indexOf(esc(en.questionnaire.ui.introSkip)));
    expect(sample).toBeLessThan(out.indexOf(esc(en.questionnaire.ui.caregiverToggle)));
    expect(out).toContain(esc(en.questionnaire.ui.sampleQuick));
    expect(out).toContain('type="checkbox"');
  });
});
