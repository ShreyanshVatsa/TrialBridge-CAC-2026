import { describe, expect, it } from "vitest";
import { buildAnalyzeBody, describeData, runSelfCheck } from "./local-check";
import { AnalyzeRequestSchema } from "../lib/types/analysis";

const routes = (over: Record<string, () => Response> = {}): typeof fetch => {
  const base: Record<string, () => Response> = {
    "/": () => new Response("<html>"),
    "/find/": () => new Response("<html>"),
    "/data/meta.json": () => Response.json({ dataVersion: "national-1", totalTrials: 5726 }),
    "/data/manifest.json": () => Response.json({ shardBase: "/data/shards/v", groups: { lung: ["lung", "solid-basket"] } }),
    "/data/shards/v/lung/cards.json": () => Response.json([{ id: "NCT00000001" }, { id: "NCT00000002" }]),
    "/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx": () => new Response(new Uint8Array(2_000_000)),
    "/api/health": () => Response.json({ ok: true }),
    "/api/analyze": () => Response.json({ status: "ok" }),
    "/sw.js": () => new Response("self.addEventListener('install',()=>{})"),
    ...over,
  };
  return (async (input: RequestInfo | URL) => {
    const p = new URL(String(input)).pathname;
    return base[p] ? base[p]() : new Response("nope", { status: 404 });
  }) as typeof fetch;
};

describe("runSelfCheck", () => {
  it("passes and reports data summary", async () => {
    const r = await runSelfCheck("http://x", routes());
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(7);
    expect(r.summary).toContain("National, 5,726 trials");
  });
  it("fails naming the check and reason", async () => {
    const r = await runSelfCheck("http://x", routes({ "/find/": () => new Response("x", { status: 500 }) }));
    expect(r.ok).toBe(false);
    expect(r.results.find((c) => !c.ok)).toMatchObject({ name: "find page (/find/)" });
    expect(r.results.find((c) => !c.ok)?.detail).toContain("500");
  });
  it("fails on a tiny model, bad analyze JSON, and unreachable server", async () => {
    expect((await runSelfCheck("http://x", routes({ "/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx": () => new Response("x") }))).ok).toBe(false);
    expect((await runSelfCheck("http://x", routes({ "/api/analyze": () => new Response("<html>") }))).ok).toBe(false);
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
    const r = await runSelfCheck("http://x", down);
    expect(r.ok).toBe(false);
    expect(r.results.every((c) => !c.ok)).toBe(true);
  });
});

describe("helpers", () => {
  it("builds a schema-valid analyze body", () => {
    expect(AnalyzeRequestSchema.safeParse(buildAnalyzeBody("lung", ["NCT00000001"])).success).toBe(true);
  });
  it("describes data", () => {
    expect(describeData("seed-1", 12)).toBe("Seed, 12 trials");
  });
});

describe("demo mode self-check", () => {
  it("passes when the server reports the mock provider", async () => {
    const r = await runSelfCheck("http://x", routes({ "/api/health": () => Response.json({ ok: true, ai: "mock" }) }), { expectMock: true });
    expect(r.ok).toBe(true);
  });
  it("fails when real provider keys are in effect", async () => {
    const r = await runSelfCheck("http://x", routes({ "/api/health": () => Response.json({ ok: true, ai: "live" }) }), { expectMock: true });
    expect(r.ok).toBe(false);
    expect(r.results.find((c) => !c.ok)?.detail).toContain("expected the mock AI provider");
  });
});
