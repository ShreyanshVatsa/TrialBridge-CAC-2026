import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MiniSearch from "minisearch";
import { DataLoadError, loadManifest, loadShard, loadMeta, loadTrial, loadTrials, lookupZip, setFetchForTests } from "@/lib/data/loader";
import { MINISEARCH_OPTIONS, toSearchDoc } from "@/lib/match/minisearch-config";
import type { Manifest, Meta, TrialCard } from "@/lib/types/trial";
import { boston, fact, makeAnswers, makeCard } from "./fixtures";

vi.mock("@/lib/match/embedder", () => ({ embedProfile: vi.fn(async () => Float32Array.from([1, 0])) }));
import { embedProfile } from "@/lib/match/embedder";
import { searchTrials } from "@/lib/match/search";

const V = "/data/shards/v1";
const cards: TrialCard[] = [
  makeCard({ id: "NCT00000001", title: "HER2 positive breast cancer study" }),
  makeCard({ id: "NCT00000002", title: "Breast cancer exercise study", facts: [fact("pregnancy", "excluded", "exclusion")] }),
];
const emb = Int8Array.from([127, 0, 0, 127]);
const index = new MiniSearch(MINISEARCH_OPTIONS);
index.addAll(cards.map(toSearchDoc));
const manifest: Manifest = {
  dataVersion: "v1",
  shardBase: V,
  embedding: { model: "m", dims: 2, quantization: "int8", scale: 127 },
  groups: { breast: ["breast"] },
  shards: [
    { id: "breast", group: "breast", kind: "full", count: 2, files: { cards: "cards.json", sites: "sites.json", index: "index.json", embeddings: "emb.bin" }, bytes: 1 },
    { id: "_all", group: "other", kind: "lite", count: 2, files: { cards: "cards.json", sites: "sites.json", index: "index.json", embeddings: "emb.bin" }, bytes: 1 },
  ],
  allShard: "_all",
  trialBase: `${V}/trials`,
};
const meta: Meta = { dataDate: "2026-10-06", dataVersion: "v1", source: "seed", totalTrials: 2, countsByGroup: { breast: 2 }, statesCovered: 1, embeddingModel: "m", llmModel: null, pipelineVersion: "1", promptVersion: "p" };
const sites = Object.fromEntries(cards.map((c) => [c.id, [boston]]));
const lite = cards.map((c) => ({ id: c.id, title: c.title, conditions: c.conditions, groups: c.groups, minAge: c.minAge, maxAge: c.maxAge, f: c.facts.map((f) => [f.key, f.value]), b: [] }));

let files: Record<string, string | Uint8Array> = {};
let fail: Record<string, number> = {};
const server = (async (input: string | URL | Request) => {
  const url = String(input);
  if (fail[url]) return new Response("err", { status: fail[url] });
  const body = files[url];
  if (body === undefined) return new Response("nf", { status: 404 });
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return new Response(bytes as BodyInit, { headers: { "content-length": String(bytes.byteLength) } });
}) as unknown as typeof fetch;

beforeEach(() => {
  fail = {};
  files = {
    "/data/meta.json": JSON.stringify(meta),
    "/data/manifest.json": JSON.stringify(manifest),
    [`${V}/breast/cards.json`]: JSON.stringify(cards),
    [`${V}/breast/sites.json`]: JSON.stringify(sites),
    [`${V}/breast/index.json`]: JSON.stringify(index.toJSON()),
    [`${V}/breast/emb.bin`]: new Uint8Array(emb.buffer),
    [`${V}/_all/cards.json`]: JSON.stringify(lite),
    [`${V}/_all/sites.json`]: JSON.stringify({ NCT00000001: [[42.34, -71.1]], NCT00000002: [[42.34, -71.1]] }),
    [`${V}/_all/index.json`]: JSON.stringify(index.toJSON()),
    [`${V}/_all/emb.bin`]: new Uint8Array(emb.buffer),
    [`${V}/trials/001.json`]: JSON.stringify({ NCT00000001: { card: cards[0], sites: [boston] } }),
    [`${V}/trials/002.json`]: JSON.stringify({ NCT00000002: { card: cards[1], sites: [boston] } }),
    "/data/zip/021.json": JSON.stringify({ "02115": [42.34, -71.1], "02116": [42.35, -71.08] }),
  };
  setFetchForTests(server);
});
afterEach(() => vi.useRealTimers());

describe("data loader", () => {
  it("loads and memoizes meta; loads trials from buckets", async () => {
    expect((await loadMeta()).totalTrials).toBe(2);
    expect((await loadTrial("nct00000001"))?.card.title).toContain("HER2");
    expect(await loadTrial("bad")).toBeNull();
    expect(await loadTrial("NCT00000777")).toBeNull();
    expect([...(await loadTrials(["NCT00000001", "NCT00000002"])).keys()]).toEqual(["NCT00000001", "NCT00000002"]);
  });
  it("adopts the head-start bucket fetch from theme-init.js, and ignores it when stale or invalid", async () => {
    const bucket = { NCT00000001: { card: cards[0], sites: [boston] } };
    const fetched: string[] = [];
    const counting = (async (u: string) => {
      fetched.push(u);
      return server(u);
    }) as unknown as typeof fetch;
    setFetchForTests(counting);
    vi.stubGlobal("window", { __tbEarlyBucket: Promise.resolve({ url: `${V}/trials/001.json`, data: bucket }) });
    expect((await loadTrial("NCT00000001"))?.card.id).toBe("NCT00000001");
    expect(fetched.some((u) => u.endsWith("/trials/001.json"))).toBe(false); // used the early response
    // Different URL (e.g. data version changed) or schema-invalid payload: normal fetch instead.
    setFetchForTests(counting);
    vi.stubGlobal("window", { __tbEarlyBucket: Promise.resolve({ url: "/other/001.json", data: bucket }) });
    expect((await loadTrial("NCT00000001"))?.card.id).toBe("NCT00000001");
    setFetchForTests(counting);
    vi.stubGlobal("window", { __tbEarlyBucket: Promise.resolve({ url: `${V}/trials/001.json`, data: { junk: 1 } }) });
    expect((await loadTrial("NCT00000001"))?.card.id).toBe("NCT00000001");
    setFetchForTests(counting);
    vi.stubGlobal("window", { __tbEarlyBucket: Promise.reject(new Error("offline")) });
    expect((await loadTrial("NCT00000001"))?.card.id).toBe("NCT00000001");
    vi.unstubAllGlobals();
  });
  it("ZIP lookup: exact, prefix fallback, unknown prefix, invalid", async () => {
    expect(await lookupZip("02115")).toEqual({ lat: 42.34, lon: -71.1 });
    const approx = await lookupZip("02199");
    expect(approx?.lat).toBeCloseTo(42.345, 3);
    expect(approx?.approximate).toBe(true);
    expect(await lookupZip("99999")).toBeNull();
    expect(await lookupZip("abc")).toBeNull();
    files["/data/zip/022.json"] = "{}";
    expect(await lookupZip("02201")).toBeNull();
  });
  it("one caller aborting a shared load does not fail the others", async () => {
    const ac = new AbortController();
    const first = lookupZip("02115", { signal: ac.signal });
    const second = lookupZip("02115");
    ac.abort();
    await expect(first).rejects.toBeDefined();
    expect(await second).toEqual({ lat: 42.34, lon: -71.1 });
    await expect(lookupZip("02115", { signal: AbortSignal.abort() })).rejects.toBeDefined();
  });
  it("rejects invalid data and retries network errors before failing", async () => {
    files["/data/meta.json"] = "{not json";
    setFetchForTests(server);
    await expect(loadMeta()).rejects.toMatchObject({ code: "invalid" });
    files["/data/meta.json"] = JSON.stringify({ wrong: 1 });
    await expect(loadMeta()).rejects.toBeInstanceOf(DataLoadError);
    fail["/data/meta.json"] = 503;
    await expect(loadMeta()).rejects.toMatchObject({ code: "network" });
  }, 15_000);
});

describe("searchTrials orchestration", () => {
  it("searches a group shard with embeddings and reports progress", async () => {
    const stages: string[] = [];
    const out = await searchTrials(makeAnswers({ biomarkers: { HER2: "positive" } }), { onProgress: (p) => stages.push(p.stage) });
    expect(out.results.map((r) => r.card.id)).toContain("NCT00000001");
    expect(out.keywordOnly).toBe(false);
    expect(stages[0]).toBe("loading_shards");
    expect(stages.at(-1)).toBe("done");
  });
  it("uses the lite index for 'not sure' and hydrates full cards", async () => {
    const out = await searchTrials(makeAnswers({ cancerType: "other", pregnant: "yes" }));
    expect(out.results).toHaveLength(2);
    expect(out.results[0]?.card.inclusion.length).toBeGreaterThan(0);
    expect(out.results.find((r) => r.card.id === "NCT00000002")?.precheck[0]?.kind).toBe("conflict");
  });
  it("falls back to keyword-only when embedding fails, and handles groups with no shard", async () => {
    vi.mocked(embedProfile).mockResolvedValueOnce(null);
    expect((await searchTrials(makeAnswers())).keywordOnly).toBe(true);
    expect((await searchTrials(makeAnswers({ cancerType: "lung" }))).results).toEqual([]);
  });
  it("tells the UI when the travel limit could not be applied (ZIP table unavailable) instead of dropping it silently", async () => {
    const ok = await searchTrials(makeAnswers({ travelMiles: 25 }));
    expect(ok.distanceUnavailable).toBeUndefined();
    delete files["/data/zip/021.json"];
    setFetchForTests(server);
    const out = await searchTrials(makeAnswers({ travelMiles: 25 }));
    expect(out.distanceUnavailable).toBe(true);
    expect(out.results.length).toBeGreaterThan(0);
    // No travel limit set: nothing was dropped, so no notice.
    expect((await searchTrials(makeAnswers({ travelMiles: null }))).distanceUnavailable).toBeUndefined();
  });
  it("flags a ZIP that is not a known ZIP area as approximate", async () => {
    const out = await searchTrials(makeAnswers({ zip: "02199", travelMiles: 250 }));
    expect(out.zipApproximate).toBe(true);
    expect((await searchTrials(makeAnswers({ travelMiles: 250 }))).zipApproximate).toBeUndefined();
  });
  it("reports shard download progress to a caller that joins an in-flight load", async () => {
    const manifestData = await loadManifest();
    const info = manifestData.shards[0]!;
    const first: number[] = [];
    const second: number[] = [];
    const p1 = loadShard(info, manifestData.shardBase, { onProgress: (f) => first.push(f) });
    const p2 = loadShard(info, manifestData.shardBase, { onProgress: (f) => second.push(f) });
    await Promise.all([p1, p2]);
    expect(second.length).toBeGreaterThan(0);
    expect(Math.max(...second)).toBeGreaterThan(0);
    // Joining an already finished load reports completion.
    const third: number[] = [];
    await loadShard(info, manifestData.shardBase, { onProgress: (f) => third.push(f) });
    expect(third).toEqual([1]);
  });
  it("rejects invalid answers and honors abort", async () => {
    await expect(searchTrials({ ...makeAnswers(), zip: "12" })).rejects.toThrow();
    const ac = new AbortController();
    ac.abort(new Error("stop"));
    await expect(searchTrials(makeAnswers(), { signal: ac.signal })).rejects.toThrow();
  });
});

import { prefetchSearch } from "@/lib/match/search";
describe("prefetchSearch", () => {
  it("warms shards and the model without throwing, even when loading fails", async () => {
    const seen: string[] = [];
    setFetchForTests((async (u: string) => {
      seen.push(String(u));
      return server(u);
    }) as unknown as typeof fetch);
    prefetchSearch("breast");
    prefetchSearch("other");
    await vi.waitFor(() => expect(seen).toContain(`${V}/_all/emb.bin`));
    expect(seen).toContain(`${V}/breast/cards.json`);
    setFetchForTests((async () => new Response("x", { status: 404 })) as unknown as typeof fetch);
    expect(() => prefetchSearch("lung")).not.toThrow();
  });
});

describe("stale manifest recovery", () => {
  it("re-fetches the manifest once when a shard or bucket is gone, then loads the new version", async () => {
    const V2 = "/data/shards/v2";
    const fresh: Manifest = { ...manifest, dataVersion: "v2", shardBase: V2, trialBase: `${V2}/trials` };
    let manifestFetches = 0;
    const flipping = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/data/manifest.json") {
        manifestFetches++;
        // The first copy is the browser's stale cached manifest; a reload gets the live one.
        return new Response(JSON.stringify(init?.cache === "reload" ? fresh : manifest));
      }
      return server(url);
    }) as unknown as typeof fetch;
    // Only the v2 files exist on the server now.
    for (const k of Object.keys(files)) if (k.startsWith(V)) {
      files[k.replace(V, V2)] = files[k] as string | Uint8Array;
      delete files[k];
    }
    setFetchForTests(flipping);
    const { loadGroupShards } = await import("@/lib/match/group-data");
    const data = await loadGroupShards("breast");
    expect(data.manifest.dataVersion).toBe("v2");
    expect(data.shards[0]?.entries).toHaveLength(2);
    expect(manifestFetches).toBe(2);
    expect((await loadTrial("NCT00000001"))?.card.id).toBe("NCT00000001");
    // When the live manifest is unchanged, the 404 is a real missing file.
    setFetchForTests(server);
    delete files[`${V2}/breast/cards.json`];
    files["/data/manifest.json"] = JSON.stringify(fresh);
    await expect(loadGroupShards("breast")).rejects.toMatchObject({ code: "not_found" });
  });
});
