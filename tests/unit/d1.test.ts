import { describe, expect, it, vi } from "vitest";
import { D1KvStore } from "@/functions/lib/store";
import { D1TrialStore } from "@/functions/lib/trials";
import { breakerFor, resetBreakersForTests } from "@/functions/lib/ai/circuit";
import { cn } from "@/lib/utils";
import { createTestD1 } from "./d1-fake";
import { loadSeedServerTrials } from "./server-fixtures";

describe("D1 stores (SQLite-backed)", () => {
  it("kv: put/get/TTL, atomic incr with expiry reset, purge", async () => {
    const db = createTestD1();
    const s = new D1KvStore(db);
    await s.put("a", "x", 60);
    expect(await s.get("a")).toBe("x");
    await s.put("a", "y", 60);
    expect(await s.get("a")).toBe("y");
    expect(await s.incr("c", 60)).toBe(1);
    expect(await s.incr("c", 60)).toBe(2);
    expect(await s.incr("c", 60, 4500)).toBe(4502);
    expect(await s.incr("t", 60, 3000)).toBe(3000);
    await s.put("old", "1", -1);
    expect(await s.get("old")).toBeNull();
    expect(await s.incr("old", 60)).toBe(1); // expired counter restarts
    await s.purgeExpired();
    expect(await s.get("missing")).toBeNull();
  });
  it("trials: loads by ID in request order, skips unknown and invalid rows", async () => {
    const db = createTestD1();
    const trials = loadSeedServerTrials(3);
    for (const t of trials) await db.prepare("INSERT INTO trials (nct_id, data_version, payload) VALUES (?, ?, ?)").bind(t.id, "v", JSON.stringify(t)).run();
    await db.prepare("INSERT INTO trials (nct_id, data_version, payload) VALUES (?, ?, ?)").bind("NCT00000099", "v", JSON.stringify({ bad: true })).run();
    const store = new D1TrialStore(db);
    const ids = [trials[2]?.id ?? "", "NCT00000099", "NCT12345678", trials[0]?.id ?? ""];
    expect((await store.getTrials(ids)).map((t) => t.id)).toEqual([trials[2]?.id, trials[0]?.id]);
    expect(await store.getTrials([])).toEqual([]);
  });
});

describe("misc", () => {
  it("breaker registry is per provider and resettable", () => {
    const a = breakerFor("x");
    expect(breakerFor("x")).toBe(a);
    resetBreakersForTests();
    expect(breakerFor("x")).not.toBe(a);
  });
  it("cn merges tailwind classes", () => {
    expect(cn("p-2", false && "x", "p-4")).toBe("p-4");
  });
  it("vi is available", () => expect(vi).toBeDefined());
});
