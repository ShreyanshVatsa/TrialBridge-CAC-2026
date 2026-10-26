import { describe, expect, it } from "vitest";
import { isScreeningItem } from "@/lib/match/screening";

const inc = (text: string) => ({ section: "inclusion" as const, text });
const exc = (text: string) => ({ section: "exclusion" as const, text });

describe("isScreeningItem", () => {
  it("consent, visits, labs, heart tests, contraception, tissue and life expectancy", () => {
    for (const t of [
      "Signed informed consent",
      "Be willing to attend study visits as required by the protocol",
      "Platelets >= 75,000/mcL",
      "Total bilirubin < 1.2 mg/dL (must be obtained <= 7 days prior to randomization)",
      "Participants must have adequate organ and marrow function as defined below:",
      "Left ventricular ejection fraction (LVEF) >= 50%",
      "Male subjects should agree to use an adequate method of contraception",
      "Participants must be willing to release archival tissue if available",
      "Life expectancy of greater than 12 weeks.",
    ])
      expect(isScreeningItem(inc(t)), t).toBe(true);
    expect(isScreeningItem(exc("Glomerular filtration rates (GFR) less than 45 mL/min"))).toBe(true);
  });
  it("never when the item names something the patient can answer", () => {
    for (const t of [
      "Adult males or females 18 years of age or older at time of signing informed consent",
      "Participants with severe known kidney disease [as defined by eGFR less than 30]",
      "Significant cardiovascular disease including ejection fraction < 40% and atrial fibrillation",
      "Known HIV infection with CD4 count < 350",
      "Prior chemotherapy with ANC recovery",
      "ECOG performance status 0-1",
    ])
      expect(isScreeningItem(inc(t)), t).toBe(false);
  });
});
