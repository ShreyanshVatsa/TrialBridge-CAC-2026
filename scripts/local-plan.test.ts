import { describe, expect, it } from "vitest";
import { aiMode, nodeOk, parseEnvFile, planLocal, type LocalState } from "./local-plan";

const base: LocalState = {
  mode: "default", rebuild: false, modelFilesPresent: true, dataVersion: "national-20261007-abc", criteriaSqlPresent: true,
  devVarsPresent: true, buildMtimeMs: 2000, newestSourceMtimeMs: 1000,
};

describe("planLocal", () => {
  it("does nothing extra when everything is fresh", () => {
    expect(planLocal(base)).toMatchObject({ fetchModels: false, ingest: null, createDevVars: false, build: false });
  });
  it("fetches national data when no data exists and rebuilds", () => {
    const p = planLocal({ ...base, dataVersion: null, criteriaSqlPresent: false });
    expect(p.ingest).toBe("national");
    expect(p.build).toBe(true);
  });
  it("keeps existing national data and upgrades seed data to national by default", () => {
    expect(planLocal({ ...base, dataVersion: "seed-1" }).ingest).toBe("national");
    expect(planLocal({ ...base, dataVersion: "national-1" }).ingest).toBeNull();
  });
  it("never replaces national data with seed unless local:seed is explicit", () => {
    expect(planLocal({ ...base, criteriaSqlPresent: false }).ingest).toBe("national");
    expect(planLocal({ ...base, mode: "seed" }).ingest).toBe("seed");
  });
  it("demo keeps existing data and builds the seed only when there is none", () => {
    expect(planLocal({ ...base, mode: "demo" })).toMatchObject({ ingest: null, build: false });
    expect(planLocal({ ...base, mode: "demo", dataVersion: "seed-1" }).ingest).toBeNull();
    expect(planLocal({ ...base, mode: "demo", dataVersion: null, criteriaSqlPresent: false })).toMatchObject({ ingest: "seed", build: true });
  });
  it("local:national always ingests national", () => {
    expect(planLocal({ ...base, mode: "national" })).toMatchObject({ ingest: "national", build: true });
  });
  it("fetches models and creates .dev.vars when missing", () => {
    expect(planLocal({ ...base, modelFilesPresent: false, devVarsPresent: false })).toMatchObject({ fetchModels: true, createDevVars: true });
  });
  it("builds when output is missing, stale, or --rebuild", () => {
    expect(planLocal({ ...base, buildMtimeMs: null }).build).toBe(true);
    expect(planLocal({ ...base, newestSourceMtimeMs: 3000 }).build).toBe(true);
    expect(planLocal({ ...base, rebuild: true }).build).toBe(true);
    expect(planLocal({ ...base, newestSourceMtimeMs: null }).build).toBe(false);
  });
});

describe("helpers", () => {
  it("detects AI mode without exposing keys", () => {
    const provs = [{ name: "groq", keyEnv: "G", dataTermsVerified: true }, { name: "x", keyEnv: "X", dataTermsVerified: false }];
    expect(aiMode(provs, {})).toEqual({ mode: "mock" });
    expect(aiMode(provs, { G: " ", X: "k" })).toEqual({ mode: "mock" });
    expect(aiMode(provs, { G: "k", X: "k" })).toEqual({ mode: "real", providers: ["groq"] });
  });
  it("parses env files", () => {
    expect(parseEnvFile("# c\nA=1\nB=\"two\"\n\nbad\n")).toEqual({ A: "1", B: "two" });
  });
  it("checks node version", () => {
    expect(nodeOk("v22.1.0")).toBe(true);
    expect(nodeOk("v20.9.0")).toBe(false);
  });
});
