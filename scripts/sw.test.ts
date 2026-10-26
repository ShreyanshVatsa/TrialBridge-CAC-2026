import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { SW_PLACEHOLDER, computeBuildId, stampServiceWorker } from "./sw-build";

const SRC = readFileSync("public/sw.js", "utf8");

describe("sw build id", () => {
  it("is deterministic, order independent, and changes with content", () => {
    const a = computeBuildId([["a.html", "1"], ["b.js", "2"]]);
    expect(computeBuildId([["b.js", "2"], ["a.html", "1"]])).toBe(a);
    expect(computeBuildId([["a.html", "1"], ["b.js", "3"]])).not.toBe(a);
    expect(a).toMatch(/^[a-f0-9]{12}$/);
  });
  it("stamps the placeholder and rejects bad input", () => {
    expect(SRC).toContain(SW_PLACEHOLDER);
    const out = stampServiceWorker(SRC, "abc123def456");
    expect(out).not.toContain(SW_PLACEHOLDER);
    expect(out).toContain("abc123def456");
    expect(() => stampServiceWorker(out, "abc123def456")).toThrow(/placeholder/);
    expect(() => stampServiceWorker(SRC, "bad id\";")).toThrow(/invalid/);
  });
});

/** Run the stamped worker in a sandbox with fake Cache Storage and capture its listeners. */
function load(id: string, existing: string[]) {
  const store = new Map<string, Map<string, unknown>>(existing.map((k) => [k, new Map()]));
  const listeners: Record<string, (e: unknown) => void> = {};
  let claimed = false;
  let skipped = false;
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
    open: async (k: string) => {
      if (!store.has(k)) store.set(k, new Map());
      const m = store.get(k) as Map<string, unknown>;
      return { add: async (r: { url: string }) => void m.set(r.url, 1), put: async (k2: unknown) => void m.set(String(k2), 1) };
    },
    match: async () => undefined,
  };
  const self = {
    location: { origin: "https://x.test" },
    clients: { claim: async () => void (claimed = true) },
    skipWaiting: () => void (skipped = true),
    addEventListener: (t: string, fn: (e: unknown) => void) => void (listeners[t] = fn),
  };
  vm.runInNewContext(stampServiceWorker(SRC, id), { self, caches, Request: class { constructor(public url: string) {} }, URL, Response, fetch: async () => new Response("x") });
  return { store, listeners, state: () => ({ claimed, skipped }) };
}

describe("service worker behavior", () => {
  it("installs into a versioned cache and activation deletes only older tb-shell caches", async () => {
    const w = load("abcdef000001", ["tb-shell-oldbuild", "tb-shell-v1", "tb-shell-abcdef000001", "other-app-cache"]);
    let installed: Promise<unknown> = Promise.resolve();
    w.listeners.install?.({ waitUntil: (p: Promise<unknown>) => (installed = p) });
    await installed;
    expect(w.store.has("tb-shell-abcdef000001")).toBe(true);
    let activated: Promise<unknown> = Promise.resolve();
    w.listeners.activate?.({ waitUntil: (p: Promise<unknown>) => (activated = p) });
    await activated;
    expect([...w.store.keys()].sort()).toEqual(["other-app-cache", "tb-shell-abcdef000001"]);
    expect(w.state().claimed).toBe(true);
    w.listeners.message?.({ data: "SKIP_WAITING" });
    expect(w.state().skipped).toBe(true);
  });

  it("only precaches shell pages/assets, never api/data/models/ort", () => {
    const shellList = /const SHELL_PAGES = (\[[^\]]*\]);\s*const SHELL_ASSETS = (\[[^\]]*\]);/.exec(SRC);
    const urls = [...(JSON.parse(shellList?.[1] ?? "[]") as string[]), ...(JSON.parse(shellList?.[2] ?? "[]") as string[])];
    expect(urls.length).toBeGreaterThan(5);
    for (const u of urls) expect(u).not.toMatch(/^\/(api|data|models|ort)\//);
  });

  it("does not intercept never-cached paths or non-GET requests", () => {
    const w = load("abcdef000001", []);
    const handle = (url: string, method = "GET", mode = "cors") => {
      let responded = false;
      w.listeners.fetch?.({ request: { method, url: `https://x.test${url}`, mode }, respondWith: () => void (responded = true) });
      return responded;
    };
    for (const p of ["/api/analyze", "/data/index.json", "/models/a.onnx", "/ort/ort.wasm"]) {
      expect(handle(p)).toBe(false);
      expect(handle(p, "GET", "navigate")).toBe(false);
    }
    expect(handle("/_next/static/x.js", "POST")).toBe(false);
    expect(handle("/_next/static/x.js")).toBe(true);
    expect(handle("/find/", "GET", "navigate")).toBe(true);
    expect(handle("/random.json")).toBe(false);
  });
});
