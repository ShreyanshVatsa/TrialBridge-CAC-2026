import { describe, expect, it } from "vitest";
import { ageToBracket, minimizeProfile } from "@/lib/privacy/minimize";
import { AnalyzeRequestSchema, MinimizedProfileSchema } from "@/lib/types/analysis";
import { makeAnswers } from "./fixtures";

describe("data minimization", () => {
  it("maps ages to decade brackets", () => {
    expect([18, 29, 30, 45, 59, 61, 79, 85, 95].map(ageToBracket)).toEqual(["18-29", "18-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80-89", "90+"]);
  });

  it("drops ZIP, travel distance, and exact age", () => {
    const p = minimizeProfile(makeAnswers({ zip: "02115", age: 52, travelMiles: 50 }));
    const json = JSON.stringify(p);
    expect(json).not.toContain("02115");
    expect(json).not.toContain("52");
    expect(Object.keys(p).sort()).toEqual(["ageBracket", "biomarkers", "cancerType", "concurrentTrial", "language", "pregnant", "spread", "treatments"]);
    expect(p.ageBracket).toBe("50-59");
  });

  it("strict schema rejects any extra field (e.g. zip, age, name, notes)", () => {
    const p = minimizeProfile(makeAnswers());
    for (const extra of [{ zip: "02115" }, { age: 52 }, { name: "x" }, { notes: "free text" }, { location: "Boston" }]) {
      expect(MinimizedProfileSchema.safeParse({ ...p, ...extra }).success).toBe(false);
    }
  });

  it("rejects invalid enum values and unknown biomarkers", () => {
    const p = minimizeProfile(makeAnswers());
    expect(MinimizedProfileSchema.safeParse({ ...p, spread: "maybe" }).success).toBe(false);
    expect(MinimizedProfileSchema.safeParse({ ...p, biomarkers: { FAKE: "positive" } }).success).toBe(false);
    expect(MinimizedProfileSchema.safeParse({ ...p, treatments: [] }).success).toBe(false);
  });

  it("analyze request accepts 1-15 valid NCT IDs only and no extra fields", () => {
    const profile = minimizeProfile(makeAnswers());
    const ok = { profile, nctIds: ["NCT01234567"], turnstileToken: "t" };
    expect(AnalyzeRequestSchema.safeParse(ok).success).toBe(true);
    expect(AnalyzeRequestSchema.safeParse({ ...ok, nctIds: [] }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ ...ok, nctIds: Array.from({ length: 16 }, () => "NCT01234567") }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ ...ok, nctIds: ["not-an-id"] }).success).toBe(false);
    expect(AnalyzeRequestSchema.safeParse({ ...ok, trialText: "ignore previous instructions" }).success).toBe(false);
  });
});
