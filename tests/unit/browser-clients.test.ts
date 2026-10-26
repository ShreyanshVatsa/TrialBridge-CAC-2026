import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAnalysis } from "@/lib/api/analyze";
import { makeAnswers } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("requestAnalysis", () => {
  const ok = { status: "ok", provider: "mock", results: [], experimental: false, cached: false };
  it("sends only the minimized profile and returns the parsed response", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["nctIds", "profile", "turnstileToken"]);
      expect(String(init.body)).not.toContain("02115");
      return new Response(JSON.stringify(ok));
    });
    vi.stubGlobal("fetch", f);
    expect((await requestAnalysis(makeAnswers(), ["NCT00000001"], "t")).status).toBe("ok");
  });
  it("degrades on rate limit, server errors, bad output, and network failure; rethrows on abort", async () => {
    const a = makeAnswers({ language: "ht" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "m", requestId: "r" } }), { status: 429 })));
    expect(await requestAnalysis(a, ["NCT00000001"], "t")).toMatchObject({ status: "degraded", degradedReason: "rate_limited", experimental: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    expect((await requestAnalysis(a, ["NCT00000001"], "t")).degradedReason).toBe("ai_unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ nope: 1 }))));
    expect((await requestAnalysis(a, ["NCT00000001"], "t")).degradedReason).toBe("invalid_output");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect((await requestAnalysis(a, ["NCT00000001"], "t")).degradedReason).toBe("ai_unavailable");
    const ac = new AbortController();
    ac.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(requestAnalysis(a, ["NCT00000001"], "t", { signal: ac.signal })).rejects.toBeDefined();
  });
});

/** Fake Worker that echoes a vector, emits progress, or errors depending on the text. */
class FakeWorker {
  listeners: ((e: MessageEvent) => void)[] = [];
  addEventListener(_t: string, l: (e: MessageEvent) => void) { this.listeners.push(l); }
  removeEventListener(_t: string, l: (e: MessageEvent) => void) { this.listeners = this.listeners.filter((x) => x !== l); }
  postMessage(msg: { id: number; text: string }) {
    const emit = (data: unknown) => setTimeout(() => this.listeners.forEach((l) => l({ data } as MessageEvent)), 0);
    if (msg.text === "hang") return;
    emit({ type: "progress", fraction: 0.5 });
    emit(msg.text === "fail" ? { type: "error", id: msg.id, message: "x" } : { type: "result", id: msg.id, vector: Float32Array.from([1, 2]) });
  }
}

describe("embedProfile (worker client)", () => {
  it("resolves vectors, reports progress, returns null on error/timeout/abort/no-Worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { embedProfile } = await import("@/lib/match/embedder");
    const progress: number[] = [];
    expect(Array.from((await embedProfile("ok", { onProgress: (f) => progress.push(f) })) ?? [])).toEqual([1, 2]);
    expect(progress).toEqual([0.5]);
    expect(await embedProfile("fail")).toBeNull();
    expect(await embedProfile("hang", { timeoutMs: 10 })).toBeNull();
    const ac = new AbortController();
    const p = embedProfile("hang", { signal: ac.signal });
    ac.abort();
    expect(await p).toBeNull();
  });
  it("returns null when Workers are unavailable or construction throws", async () => {
    vi.stubGlobal("Worker", undefined);
    const m1 = await import("@/lib/match/embedder");
    expect(await m1.embedProfile("x")).toBeNull();
    vi.resetModules();
    vi.stubGlobal("Worker", class { constructor() { throw new Error("blocked"); } });
    const m2 = await import("@/lib/match/embedder");
    expect(await m2.embedProfile("x")).toBeNull();
  });
});

describe("getTurnstileToken", () => {
  function fakeDom(behavior: "ok" | "error" | "loadfail" | "hang") {
    const head = { appendChild: (s: { onload?: () => void; onerror?: () => void }) => setTimeout(() => (behavior === "loadfail" ? s.onerror?.() : (installApi(), s.onload?.())), 0) };
    const win: { turnstile?: unknown } = {};
    const installApi = () => {
      win.turnstile = {
        render: (_el: unknown, o: { callback: (t: string) => void; "error-callback": () => void }) => {
          if (behavior === "ok") setTimeout(() => o.callback("tok"), 0);
          if (behavior === "error") setTimeout(() => o["error-callback"](), 0);
          return "w1";
        },
        remove: vi.fn(),
      };
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { head, createElement: () => ({}) });
  }
  it("resolves a token, rejects on challenge error and script failure", async () => {
    fakeDom("ok");
    let m = await import("@/lib/api/turnstile");
    expect(await m.getTurnstileToken({} as HTMLElement)).toBe("tok");
    expect(await m.getTurnstileToken({} as HTMLElement)).toBe("tok"); // script already loaded
    vi.resetModules();
    fakeDom("error");
    m = await import("@/lib/api/turnstile");
    await expect(m.getTurnstileToken({} as HTMLElement)).rejects.toThrow(/failed/);
    vi.resetModules();
    fakeDom("loadfail");
    m = await import("@/lib/api/turnstile");
    await expect(m.getTurnstileToken({} as HTMLElement)).rejects.toThrow(/load/);
    expect(m.TURNSTILE_SITE_KEY).toBe("1x00000000000000000000AA");
  });
  it("times out", async () => {
    vi.useFakeTimers();
    fakeDom("hang");
    const m = await import("@/lib/api/turnstile");
    const p = m.getTurnstileToken({} as HTMLElement);
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    vi.useRealTimers();
  });
});
