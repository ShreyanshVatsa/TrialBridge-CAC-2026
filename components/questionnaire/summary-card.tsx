"use client";

import { ChevronDown, Clock, ClipboardList, Loader2, Search, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { format, useMessages } from "@/components/i18n";
import { inputClass } from "@/components/chat/primitives";
import { Button } from "@/components/ui/button";
import { LANGUAGES, type Language } from "@/lib/types/intake";
import { answerText } from "./answer-text";
import { ESSENTIAL_IDS, isEssential, isNonResponse, type FindOutEntry, type QuestionDef, type QuestionId, type QuestionnaireState } from "./contract";
import { FindOutList } from "./find-out-list";
import { travelLabel } from "./inputs";
import { useKeyT, variantKey } from "./t";

/** Summary card before the search: edit any answer, see the Find-out list and waiting questions, then search. */
export function SummaryCard({
  state,
  catalog,
  findOut,
  deepLeft,
  caregiver = false,
  language,
  onLanguage,
  onEdit,
  onFill,
  onMore,
  onSearch,
}: {
  state: QuestionnaireState;
  catalog: readonly QuestionDef[];
  findOut: readonly FindOutEntry[];
  deepLeft: number;
  caregiver?: boolean;
  language: Language;
  onLanguage: (l: Language) => void;
  onEdit: (id: QuestionId) => void;
  onFill: (ids: QuestionId[]) => void;
  onMore: () => void;
  onSearch: () => void;
}) {
  const m = useMessages();
  const t = useKeyT();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const langId = useId();
  const [searching, setSearching] = useState(false);
  useEffect(() => headingRef.current?.focus(), []);

  const byId = new Map<string, QuestionDef>(catalog.map((q) => [q.id, q]));
  const a = state.answers;
  const rows: { id: QuestionId; label: string; value: string }[] = [];
  const cancer = byId.get("cancer_type");
  if (cancer) rows.push({ id: "cancer_type", label: m.chat.labels.cancerType, value: answerText(cancer, state, t, m) });
  rows.push({ id: "age", label: m.chat.labels.age, value: String(a.age ?? "") });
  rows.push({
    id: "zip",
    label: m.chat.labels.location,
    value: format(m.chat.locationValue, { zip: String(a.zip ?? ""), travel: travelLabel(typeof a.travel === "number" ? a.travel : null, m) }),
  });
  for (const id of state.history) {
    const q = byId.get(id);
    if (!q || isEssential(id) || a[id] === undefined) continue;
    rows.push({ id, label: t(variantKey(t, q.labelKey, caregiver)), value: answerText(q, state, t, m) });
  }
  const allUnknownGrid = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => x === "unknown");
  const isLater = (r: { id: string }) => !isEssential(r.id) && (isNonResponse(a[r.id]) || allUnknownGrid(a[r.id]) || state.deferred.includes(r.id));
  const groups = [
    { key: "you", rows: rows.filter((r) => isEssential(r.id)) },
    { key: "answered", rows: rows.filter((r) => !isEssential(r.id) && !isLater(r)) },
    { key: "later", rows: rows.filter(isLater) },
  ];
  const waiting = state.deferred.filter((id) => byId.has(id));
  const anyUnknown = rows.some((r) => !(ESSENTIAL_IDS as readonly string[]).includes(r.id) && findOut.some((f) => f.question === r.id));

  return (
    <section aria-labelledby="summary-title" className="tb-surface animate-enter space-y-6 rounded-3xl p-5 sm:p-7">
      <div>
        <h2 id="summary-title" ref={headingRef} tabIndex={-1} className="text-[1.875rem] leading-[1.02] font-bold [font-stretch:72%] outline-none sm:text-[2.25rem]">
          {t("questionnaire.ui.summaryTitle")}
        </h2>
        <p className="mt-1 text-muted-foreground">{t("questionnaire.ui.summaryIntro")}</p>
      </div>

      {groups.map((g) =>
        g.rows.length === 0 ? null : (
          <section key={g.key} aria-labelledby={`sum-${g.key}`}>
            <h3 id={`sum-${g.key}`} className="flex items-center gap-2 border-b border-border pb-2 font-sans text-base font-semibold tracking-[0.05em] text-muted-foreground uppercase [font-stretch:100%]">
              {g.key === "later" && <ClipboardList aria-hidden className="size-4 text-primary" />}
              {t(`questionnaire.ui.summaryGroup.${g.key}`)}
            </h3>
            {g.key === "later" && <p className="text-base text-muted-foreground">{t("questionnaire.ui.summaryGroup.laterNote")}</p>}
            <ul className="divide-y divide-border">
              {g.rows.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-base text-muted-foreground">{r.label}</p>
                    <p className="font-medium break-words">
                      {r.value}
                      {g.key === "later" && findOut.some((f) => f.question === r.id) && (
                        <span className="ms-2 inline-flex rounded-full border border-border px-2 text-base font-normal text-muted-foreground">{t("questionnaire.ui.onYourList")}</span>
                      )}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => onEdit(r.id)} aria-label={`${m.common.edit}: ${r.label}`} className="min-h-11 shrink-0">
                    {m.common.edit}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {anyUnknown && <p className="rounded-2xl bg-secondary/60 px-4 py-3">{t("questionnaire.ui.summaryUnknownNote")}</p>}

      {waiting.length > 0 && (
        <section aria-labelledby="waiting-title" className="rounded-2xl border border-border p-4 sm:p-5">
          <h3 id="waiting-title" className="flex items-center gap-2 text-lg font-semibold">
            <Clock aria-hidden className="size-4 text-primary" />
            {t("questionnaire.ui.waitingTitle")}
          </h3>
          <p className="mt-1 text-muted-foreground">{t("questionnaire.ui.waitingIntro")}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {waiting.map((id) => {
              const label = t(byId.get(id)!.labelKey);
              return (
                <li key={id}>
                  <Button variant="outline" onClick={() => onFill([id])} className="min-h-11 h-auto whitespace-normal text-start">
                    {t("questionnaire.ui.fillIn", { question: label })}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <FindOutList entries={findOut} headingLevel={3} className="border-dashed shadow-none" />

      {deepLeft > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <p className="text-muted-foreground">{t("questionnaire.ui.moreOptionalNote")}</p>
          <Button variant="outline" onClick={onMore} className="h-auto min-h-11 whitespace-normal">
            {t("questionnaire.ui.moreOptional", { count: deepLeft })}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor={langId} className="block font-medium">
          {t("questionnaire.ui.studyLanguage")}
        </label>
        <div className="relative max-w-sm">
          <select id={langId} value={language} onChange={(e) => onLanguage(e.target.value as Language)} className={`${inputClass} cursor-pointer appearance-none pe-10`}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {m.options.language[l]}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
        <Button
          size="lg"
          className="min-h-14 shrink-0 px-8 text-lg"
          disabled={searching}
          aria-busy={searching}
          onClick={() => {
            setSearching(true);
            onSearch();
          }}
        >
          {searching ? <Loader2 aria-hidden className="motion-safe:animate-spin" /> : <Search aria-hidden />}
          {searching ? t("questionnaire.ui.searching") : t("questionnaire.ui.search")}
        </Button>
        <p className="flex items-start gap-2 text-base text-muted-foreground">
          <ShieldCheck className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
          {t("questionnaire.ui.privacyNote")}
        </p>
      </div>
    </section>
  );
}
