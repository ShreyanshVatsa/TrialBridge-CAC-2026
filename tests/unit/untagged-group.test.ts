import { describe, expect, it } from "vitest";
import { passesGroup } from "@/lib/match/filters";
import { makeCard } from "./fixtures";

describe("untagged trials that name the group", () => {
  it("an 'other' trial passes the group its own conditions name, and no other", () => {
    const c = makeCard({ groups: ["other"], conditions: ["Pleural Effusion, Malignant"], title: "Talc slurry" });
    expect(passesGroup(c, "lung")).toBe(true);
    expect(passesGroup(c, "breast")).toBe(false);
    expect(passesGroup(makeCard({ groups: ["other"], conditions: ["Infertility"], title: "x" }), "lung")).toBe(false);
    expect(passesGroup(makeCard({ groups: ["breast"], conditions: ["lung cancer"], title: "x" }), "lung")).toBe(false);
  });
});
