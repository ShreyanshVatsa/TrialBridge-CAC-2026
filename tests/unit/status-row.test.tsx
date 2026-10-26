import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatusRow, rulesReasonOf } from "@/components/results/status-row";
import { en } from "@/components/i18n/en";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("rulesReasonOf", () => {
  it("budget and rate limits say the daily capacity is used up, everything else is generic", () => {
    expect(rulesReasonOf("budget_exhausted")).toBe("budget");
    expect(rulesReasonOf("rate_limited")).toBe("budget");
    expect(rulesReasonOf("ai_unavailable")).toBe("unavailable");
    expect(rulesReasonOf()).toBe("unavailable");
  });
});

describe("StatusRow", () => {
  it("rules-only: one calm chip, the reason in the details, never amber", () => {
    const out = html(<StatusRow ai={{ kind: "rules", reason: "budget" }} filters={[]} />);
    expect(out).toContain(en.results.status.rules);
    expect(out).toContain("free AI reading capacity is used up");
    expect(out).not.toContain("warn");
    expect(html(<StatusRow ai={{ kind: "rules" }} filters={[]} />)).toContain(en.match.degraded);
  });
  it("done: the trial count, the AI note and a rules-only note when criteria fell back", () => {
    const out = html(<StatusRow ai={{ kind: "done", trials: 5, experimental: false, rulesOnly: "unavailable" }} filters={[]} />);
    expect(out).toContain("AI read 5 trials");
    expect(out).toContain(en.results.aiNote);
    expect(out).toContain(en.match.degraded);
  });
  it("filters collapse into one chip with the notices inside the disclosure", () => {
    const out = html(<StatusRow ai={{ kind: "off" }} filters={["Studies only for men were hidden.", "Second"]} />);
    expect(out).toContain("Filters applied (2)");
    expect(out).toContain("<details");
    expect(out).toContain("Studies only for men were hidden.");
  });
  it("renders nothing visible with no AI step and no filters", () => {
    const out = html(<StatusRow ai={{ kind: "off" }} filters={[]} />);
    expect(out).not.toContain("<details");
  });
});
