import { describe, expect, it } from "vitest";
import { mockAsk, stem } from "@/functions/lib/ai/mock-ask";
import type { ServerTrial } from "@/functions/lib/trials";

const trial: ServerTrial = {
  id: "NCT04704323",
  title: "Study of a new drug in leukemia",
  summary: "Adults with leukemia receive the drug.",
  inclusion: [{ n: 1, text: "Age 18 years or older." }],
  exclusion: [{ n: 1, text: "Patients with brain metastasis or leptomeningeal disease are not eligible." }],
  minAge: 18,
  maxAge: null,
  groups: ["leukemia"],
  facts: [],
  barriers: [],
};

describe("mock Q&A stemming", () => {
  it("meets singular and plural forms", () => {
    expect(stem("metastasis")).toBe(stem("metastases"));
    expect(stem("diagnosis")).toBe(stem("diagnoses"));
    expect(stem("therapy")).toBe(stem("therapies"));
    expect(stem("disease")).toBe(stem("diseases"));
    expect(stem("trial")).toBe(stem("trials"));
    expect(stem("study")).toBe(stem("studies"));
  });
  it("answers a plural question from singular trial text with a citation", () => {
    const r = mockAsk(trial, "Can people with brain metastases join?", "en");
    expect(r.kind).toBe("answer");
    expect(r.citations[0]).toMatchObject({ section: "exclusion", number: 1 });
    expect(r.citations[0]?.quote).toContain("brain metastasis");
  });
  it("answers a singular question from plural trial text", () => {
    const t = { ...trial, exclusion: [{ n: 2, text: "Known brain metastases." }] };
    expect(mockAsk(t, "Is brain metastasis allowed?", "en").kind).toBe("answer");
  });
});
