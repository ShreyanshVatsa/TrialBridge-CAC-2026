import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeDataVersion, DataLockSchema, newSnapshotDir, readSnapshotState, resolveSnapshotDir, snapshotPageHashes, snapshotQueryKey, verifyModelFiles, sha256Hex } from "@/lib/ingest/snapshot";
import { splitOf } from "../../scripts/eval/vignettes/schema";

const enc = (s: string) => new TextEncoder().encode(s);

describe("computeDataVersion", () => {
  const files: [string, Uint8Array][] = [
    ["shards/_staging/lung/cards.json", enc("[1]")],
    ["shards/_staging/lung/emb.bin", new Uint8Array([1, 2, 3])],
  ];
  it("is deterministic and independent of file order", () => {
    const a = computeDataVersion("national", "2026-10-07", files, 1);
    const b = computeDataVersion("national", "2026-10-07", [...files].reverse(), 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^national-20261007-[0-9a-f]{10}$/);
  });
  it("changes when any file, the format version or a path changes", () => {
    const base = computeDataVersion("national", "2026-10-07", files, 1);
    expect(computeDataVersion("national", "2026-10-07", files, 2)).not.toBe(base);
    expect(computeDataVersion("national", "2026-10-07", [files[0] as [string, Uint8Array], ["shards/_staging/lung/emb.bin", new Uint8Array([1, 2, 4])]], 1)).not.toBe(base);
    expect(computeDataVersion("national", "2026-10-07", [files[0] as [string, Uint8Array], ["shards/_staging/lung/sites.json", new Uint8Array([1, 2, 3])]], 1)).not.toBe(base);
  });
});

describe("snapshot helpers", () => {
  it("keys a query by its parameters and field list", () => {
    const k1 = snapshotQueryKey({ a: "1" }, "f1,f2");
    expect(snapshotQueryKey({ a: "1" }, "f1,f2,f3")).not.toBe(k1);
    expect(snapshotQueryKey({ a: "1" }, "f1,f2")).toBe(k1);
  });
  it("names new snapshot directories by UTC time", () => {
    expect(newSnapshotDir(new Date("2026-10-09T21:05:07.123Z"))).toBe(path.join("data/cache/snapshots", "20261009-210507"));
  });
  it("reads page hashes, infers fetchedAt for older snapshots and resolves the newest snapshot", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tb-snap-"));
    const legacy = path.join(root, "legacy");
    mkdirSync(legacy);
    writeFileSync(path.join(legacy, "page-0001.json"), "[1]");
    writeFileSync(path.join(legacy, "page-0002.json"), "[2]");
    writeFileSync(path.join(legacy, "state.json"), JSON.stringify({ queryKey: "q", pages: 2, nextPageToken: null, done: true }));
    expect(snapshotPageHashes(legacy)).toEqual([
      { file: "page-0001.json", sha256: sha256Hex("[1]") },
      { file: "page-0002.json", sha256: sha256Hex("[2]") },
    ]);
    const st = readSnapshotState(legacy);
    expect(st?.fetchedAtApproximate).toBe(true);
    expect(st?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readSnapshotState(path.join(root, "nope"))).toBeNull();
    expect(resolveSnapshotDir({ explicit: "x" })).toBe("x");
    expect(resolveSnapshotDir({ lock: { snapshot: legacy } as never })).toBe(legacy);
    expect(resolveSnapshotDir({ lock: { snapshot: path.join(root, "gone") } as never })).not.toBe(path.join(root, "gone"));
  });
  it("verifies pinned model files", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "tb-model-"));
    writeFileSync(path.join(root, "a.json"), "{}");
    expect(verifyModelFiles(root, { "a.json": sha256Hex("{}"), "b.onnx": sha256Hex("x") })).toEqual(["b.onnx: missing"]);
    expect(verifyModelFiles(root, { "a.json": sha256Hex("other") })).toEqual(["a.json: sha256 mismatch"]);
    expect(verifyModelFiles(root, { "a.json": sha256Hex("{}") })).toEqual([]);
  });
  it("validates a lock file", () => {
    const lock = {
      lockVersion: 1,
      source: "national",
      snapshot: "data/cache/snapshots/x",
      query: { a: "b" },
      fields: "f",
      fetchedAt: "2026-10-07T00:00:00.000Z",
      pages: [{ file: "page-0001.json", sha256: sha256Hex("[1]") }],
      model: { id: "m", revision: "r", files: { "a.json": sha256Hex("{}") } },
      pipelineVersion: "1.1.0",
      formatVersion: 1,
      dataVersion: "national-20261007-abcdefabcd",
      totalTrials: 1,
    };
    expect(DataLockSchema.parse(lock)).toEqual(lock);
    expect(() => DataLockSchema.parse({ ...lock, pages: [{ file: "p", sha256: "short" }] })).toThrow();
  });
});

describe("vignette split", () => {
  it("is deterministic and roughly balanced", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `v${String(i + 1).padStart(3, "0")}`);
    const dev = ids.filter((id) => splitOf(id) === "dev").length;
    expect(dev).toBeGreaterThan(70);
    expect(dev).toBeLessThan(130);
    expect(splitOf("v001")).toBe(splitOf("v001"));
  });
});
