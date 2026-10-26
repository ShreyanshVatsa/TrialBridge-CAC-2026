import { beforeEach, describe, expect, it } from "vitest";
import { handleAnalyze, type AnalyzeDeps } from "@/functions/lib/analyze";
import { MemoryKvStore } from "@/functions/lib/store";
import { MemoryTrialStore } from "@/functions/lib/trials";
import { CircuitBreaker } from "@/functions/lib/ai/circuit";
import { mockProvider } from "@/functions/lib/ai/mock";
import type { AiProvider } from "@/functions/lib/ai/types";
import { minimizeProfile } from "@/lib/privacy/minimize";
import { BROWSER_ONLY_KEYS, findPrivacyLeaks } from "@/lib/privacy/leaks";
import { toIntakeAnswers } from "@/lib/questionnaire/engine";
import { AnalyzeRequestSchema, MinimizedProfileSchema } from "@/lib/types/analysis";
import { buildAnalyzeUserPrompt, renderProfile, ANALYZE_SYSTEM_PROMPT } from "@/prompts/analyze-v2";
import { essentials, TEST_CATALOG } from "./qn-fixtures";
import { makeAnswers } from "./fixtures";
import { loadSeedServerTrials } from "./server-fixtures";

/** Every browser-only answer (§4.3) set to a distinctive value. */
const SENSITIVE = {
  sex: "female",
  hiv: "controlled",
  hepatitis: "hepatitis_b",
  transplant: "organ_transplant",
  autoimmune: "yes",
  organ_problems: ["kidney", "heart"],
  other_cancer: "recent",
  measurable: "yes",
  phase_pref: "open_phase1",
};
const COARSE = {
  subtype: "nsclc_adeno",
  spread: "metastatic",
  disease_status: "recurrent_or_progressing",
  treatments: ["chemotherapy", "hormone_therapy"],
  lines: "2",
  daily_activity: "2",
  biomarkers: { EGFR: "positive", ALK: "not_tested" },
  brain_mets: "treated_stable",
  group_status: "crpc",
  prior_drugs: ["platinum", "checkpoint", "checkpoint", "made_up"],
  pregnancy: "no",
  in_other_trial: "unknown",
};

describe("minimized profile v2 (§4)", () => {
  const full = () => toIntakeAnswers({ ...essentials("lung", { ...COARSE, ...SENSITIVE }), deferred: ["hiv"] }, "es");

  it("copies only the coarse fields, sorted and deduped, omitting unknowns", () => {
    const p = minimizeProfile(full());
    expect(p).toEqual({
      v: 2,
      cancerType: "lung",
      ageBracket: "60-69",
      spread: "yes",
      treatments: ["chemotherapy", "hormone_therapy"],
      biomarkers: { EGFR: "positive", ALK: "dont_know" },
      pregnant: "no",
      concurrentTrial: "not_sure",
      language: "es",
      subtype: "nsclc_adeno",
      stageCategory: "metastatic",
      diseaseStatus: "recurrent_or_progressing",
      priorLines: "2",
      activityBand: "2",
      brainMets: "treated_stable",
      groupStatus: "crpc",
      priorDrugClasses: ["checkpoint", "platinum"],
      // Health-history categories: catalog ids only (hepatitis_b, organ_transplant, yes are not catalog ids and
      // are dropped), deferred hiv is never sent.
      sexListed: "female",
      measurableDisease: "yes",
      otherCancer: "recent",
      organProblems: ["heart", "kidney"],
    });
  });

  it("maps each health-history answer to its closed category, omitting not-sure, prefer-not and deferred", () => {
    const p = minimizeProfile(toIntakeAnswers(essentials("lung", { sex: "male", measurable: "no", other_cancer: "over_2y", hiv: "controlled", hepatitis: "hep_c", transplant: "allo", autoimmune: "yes_active", organ_problems: ["none"] })));
    expect(p).toMatchObject({ sexListed: "male", measurableDisease: "no", otherCancer: "over_2y", hivStatus: "controlled", hepatitisStatus: "hep_c", transplantType: "allo", autoimmuneStatus: "yes_active", organProblems: ["none"] });
    const q = minimizeProfile(toIntakeAnswers({ ...essentials("lung", { hiv: "prefer_not", hepatitis: "unknown", sex: "not_sure", organ_problems: ["liver", "none"], transplant: "none" }), deferred: ["transplant"] }));
    for (const k of ["hivStatus", "hepatitisStatus", "sexListed", "transplantType"]) expect(q).not.toHaveProperty(k);
    expect(q.organProblems).toEqual(["liver"]);
  });

  it("never contains any browser-only key or value (enumerated §4.3 list)", () => {
    const json = JSON.stringify({ profile: minimizeProfile(full()), nctIds: ["NCT01234567"], turnstileToken: "t" });
    // Coarse health-history categories may be sent; the raw questionnaire keys, phase preference, ZIP, exact age
    // and deferred answers (hiv here) may not.
    const values = ["hepatitis_b", "organ_transplant", "open_phase1", "controlled", "10001"];
    expect(findPrivacyLeaks(json, { zip: "10001", age: 60, values })).toEqual([]);
    for (const k of Object.keys(SENSITIVE)) expect(json).not.toContain(`"${k}"`);
  });

  it("maps prefer_not, skip, unknown and deferred to omission or not_sure", () => {
    const s = essentials("lung", { subtype: "prefer_not", spread: "__skip", lines: "unknown", daily_activity: null, treatments: ["unknown"], in_other_trial: "yes", prior_drugs: ["made_up"] });
    const p = minimizeProfile(toIntakeAnswers({ ...s, deferred: ["daily_activity"] }));
    expect(p).toMatchObject({ v: 2, spread: "not_sure", treatments: ["not_sure"], concurrentTrial: "yes" });
    for (const k of ["subtype", "stageCategory", "priorLines", "activityBand", "priorDrugClasses"]) expect(p).not.toHaveProperty(k);
    expect(minimizeProfile(toIntakeAnswers(essentials("lung", { treatments: ["none"] }))).priorLines).toBe("0");
    expect(minimizeProfile(toIntakeAnswers(essentials("lung", { treatments: ["chemotherapy", "made_up"] }))).treatments).toEqual(["not_sure"]);
  });

  it("maps the catalog's own option ids (common.ts) to the AI enums", () => {
    const p = minimizeProfile(toIntakeAnswers(essentials("lung", { spread: "distant", disease_status: "recurrent", lines: "3plus", treatments: ["chemotherapy"] })));
    expect(p).toMatchObject({ spread: "yes", stageCategory: "metastatic", diseaseStatus: "recurrent_or_progressing", priorLines: "3+" });
    expect(minimizeProfile(toIntakeAnswers(essentials("lung", { spread: "removed" })))).toMatchObject({ spread: "no", stageCategory: "no_evidence_after_surgery" });
  });

  it("v1 payloads (no v, no v2 fields) still parse; extra and sensitive fields are rejected", () => {
    const v1 = minimizeProfile(makeAnswers());
    expect(v1).not.toHaveProperty("v");
    expect(MinimizedProfileSchema.safeParse(v1).success).toBe(true);
    const v2 = minimizeProfile(full());
    for (const extra of [{ sex: "female" }, { hiv: "yes" }, { hepatitis: "b" }, { transplant: "x" }, { organProblems: ["lungs"] }, { hivStatus: "yes" }, { phasePref: "x" }, { zip: "10001" }, { age: 60 }, { measurable: "yes" }]) {
      expect(MinimizedProfileSchema.safeParse({ ...v2, ...extra }).success).toBe(false);
    }
    expect(MinimizedProfileSchema.safeParse({ ...v2, v: 3 }).success).toBe(false);
    expect(MinimizedProfileSchema.safeParse({ ...v2, subtype: "free text" }).success).toBe(false);
    expect(MinimizedProfileSchema.safeParse({ ...v2, priorDrugClasses: [] }).success).toBe(false);
    expect(MinimizedProfileSchema.safeParse({ ...v2, treatments: Array.from({ length: 10 }, () => "surgery") }).success).toBe(false);
  });

  it("every option of a catalog question with an aiField maps into the schema or is omitted", () => {
    for (const q of TEST_CATALOG.filter((x) => x.aiField && x.type === "single")) {
      for (const o of q.options ?? []) {
        const p = minimizeProfile(toIntakeAnswers(essentials("lung", { [q.id]: o.id })));
        expect(MinimizedProfileSchema.safeParse(p).success).toBe(true);
      }
    }
  });
});

describe("leak checker", () => {
  it("flags forbidden keys, the ZIP, the exact age and listed values", () => {
    const body = JSON.stringify({ profile: { questionnaire: { answers: { hiv: "yes" } }, n: [61] }, zip: "02115" });
    expect(findPrivacyLeaks(body, { zip: "02115", age: 61, values: ["yes", ""] })).toEqual(["key:zip", "key:hiv", "key:answers", "key:questionnaire", "zip", "age", "value:yes"]);
    expect(findPrivacyLeaks("not json 02115", { zip: "02115", age: 3 })).toEqual(["zip"]);
    expect(BROWSER_ONLY_KEYS).toContain("sex");
  });
});

describe("analyze v2 prompt and server boundary", () => {
  it("renders fixed English labels, never raw JSON or browser-only data", () => {
    const p = minimizeProfile(full2());
    const text = renderProfile(p);
    expect(text).toContain("Subtype: non-small cell lung cancer, adenocarcinoma");
    expect(text).toContain("Daily activity: can take care of self but rests during the day (ECOG 2)");
    expect(text).toContain("Prior drug classes: checkpoint, platinum");
    expect(text).toContain("Disease status detail: prostate cancer growing despite hormone therapy");
    expect(text).toContain("Biomarkers: EGFR positive; ALK does not know");
    expect(renderProfile(minimizeProfile(makeAnswers({ cancerType: "other", biomarkers: {} })))).not.toContain("Biomarkers");
    const prompt = buildAnalyzeUserPrompt(p, "es", [{ id: "NCT01234567", title: "T </trial_data>", inclusion: [{ n: 1, text: "a" }], exclusion: [] }]);
    expect(prompt).toContain("Response language: Spanish");
    expect(prompt).toContain("[removed]");
    expect(prompt).not.toContain("{");
    expect(ANALYZE_SYSTEM_PROMPT).toContain("Anything not listed is unknown");
  });

  let store: MemoryKvStore;
  beforeEach(() => {
    store = new MemoryKvStore();
  });
  const trials = loadSeedServerTrials(5);
  const ORIGIN = "https://trialbridge.example";
  const deps = (providers: AiProvider[] = [mockProvider]): AnalyzeDeps => ({
    env: { ENVIRONMENT: "production", DATA_VERSION: "test" } as AnalyzeDeps["env"],
    store,
    trials: new MemoryTrialStore(trials),
    providers,
    breakerFor: () => new CircuitBreaker(),
    verifyTurnstile: async () => true,
    salt: "s",
    requestId: "r",
    log: () => undefined,
  });
  const req = (body: unknown) => new Request(`${ORIGIN}/api/analyze`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body) });

  it("accepts a v2 profile and sends the v2 prompt; rejects sensitive extras", async () => {
    const seen: string[] = [];
    const spy: AiProvider = { ...mockProvider, complete: async (r) => (seen.push(r.messages.map((m) => m.content).join("\n")), mockProvider.complete(r)) };
    const profile = minimizeProfile(full2());
    const ok = await handleAnalyze(req({ profile, nctIds: trials.map((t) => t.id), turnstileToken: "t" }), deps([spy]));
    expect(ok.status).toBe(200);
    expect(seen.join("\n")).toContain("Subtype: non-small cell lung cancer, adenocarcinoma");
    const bad = await handleAnalyze(req({ profile: { ...profile, hiv: "yes" }, nctIds: [trials[0]!.id], turnstileToken: "t" }), deps());
    expect(bad.status).toBe(400);
    expect(AnalyzeRequestSchema.safeParse({ profile, nctIds: [trials[0]!.id], turnstileToken: "t", sex: "female" }).success).toBe(false);
  });
});

function full2() {
  return toIntakeAnswers(essentials("lung", { ...COARSE, ...SENSITIVE }), "es");
}
