"use client";

import { z } from "zod";
import evalResults from "@/eval/results.json";
import { format, localeFor, useLanguage, useMessages } from "@/components/i18n";
import { formatDate } from "@/components/format";
import { Ticker } from "@/components/fx/ticker";

/** Shape of eval/results.json (written by `npm run eval`); validated so a format change can't break the page. */
const EvalSchema = z.object({
  date: z.string(),
  profiles: z.number(),
  cancerTypes: z.number(),
  hardFilterViolationRate: z.number(),
  variants: z.array(z.object({ name: z.string(), sysRecall: z.number(), sysNdcg: z.number() })).min(1),
  facts: z.object({ sample: z.number(), correct: z.number(), precision: z.number() }),
  mockAi: z.object({ quotes: z.number(), quotePassRate: z.number() }),
});

const parsed = EvalSchema.safeParse(evalResults);

/** Headline evaluation numbers. Uses the production variant (first row, marked "production"). */
export function EvalSummary() {
  const m = useMessages().pages.methodology;
  const locale = localeFor(useLanguage());
  if (!parsed.success) return null;
  const e = parsed.data;
  const prod = e.variants.find((v) => v.name.includes("production")) ?? e.variants[0];
  if (!prod) return null;
  const pctFmt = (x: number) => `${(x * 100).toFixed(1)}%`;
  const rows = [
    { label: m.evalViolations, value: pctFmt(e.hardFilterViolationRate) },
    { label: m.evalRecall, value: prod.sysRecall.toFixed(2) },
    { label: m.evalNdcg, value: prod.sysNdcg.toFixed(2) },
    { label: format(m.evalFacts, { correct: e.facts.correct, sample: e.facts.sample }), value: pctFmt(e.facts.precision) },
    { label: format(m.evalQuotes, { quotes: e.mockAi.quotes }), value: pctFmt(e.mockAi.quotePassRate) },
  ];
  return (
    <div className="mt-6 space-y-4">
      <p className="rounded-2xl border border-warn-border bg-warn px-4 py-3 text-sm text-warn-foreground">
        {format(m.evalProvisional, { profiles: e.profiles, types: e.cancerTypes, date: formatDate(e.date, locale) })}
      </p>
      {/* Each figure is a raised tile that leans toward the pointer; the numbers roll in when seen. */}
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div
            key={r.label}
            data-tilt
            className={`tb-surface tb-spec flex flex-col justify-between gap-4 rounded-2xl p-5 ${i === 0 ? "sm:col-span-2" : ""}`}
          >
            <dt className="text-base leading-snug">{r.label}</dt>
            <dd className="font-heading text-[2.75rem] leading-none font-extrabold text-primary [font-stretch:64%]">
              <Ticker value={r.value} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
