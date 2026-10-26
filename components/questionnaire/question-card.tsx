"use client";

import { ArrowLeft, ChevronDown, Lightbulb } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useMessages } from "@/components/i18n";
import { Button } from "@/components/ui/button";
import type { CancerGroupId } from "@/config/cancer-groups";
import { cn } from "@/lib/utils";
import { DEFER, ESSENTIAL_IDS, PREFER_NOT, SKIP, UNKNOWN, isEssential, type AnswerValue, type QuestionDef } from "./contract";
import { AgeInput, BiomarkerGrid, CancerTypeInput, ChipButton, MultiChoice, SingleChoice, TravelInput, ZipInput, type ChoiceOption } from "./inputs";
import { useKeyT, variantKey } from "./t";

const NON_RESPONSE = new Set<string>([UNKNOWN, PREFER_NOT, SKIP]);

/** One question: fieldset + legend, help, "Why we're asking", tier label, impact hint, options, and equal-weight non-response chips. */
export function QuestionCard({
  q,
  initial,
  impact,
  onAnswer,
  onBack,
  autoFocus,
  extra,
  caregiver = false,
}: {
  q: QuestionDef;
  initial?: AnswerValue;
  impact?: { total: number; narrowedTo: number | null } | null;
  onAnswer: (value: AnswerValue) => void;
  onBack?: () => void;
  autoFocus: boolean;
  extra?: ReactNode;
  /** "I'm answering for someone else": uses the third-person wording variant when one exists (never stored). */
  caregiver?: boolean;
}) {
  const t = useKeyT();
  const m = useMessages();
  const legendRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const helpId = useId();
  const errId = useId();
  const name = useId();
  const essential = isEssential(q.id);
  const [error, setError] = useState<string | null>(null);

  const allOptions = q.options ?? [];
  const choiceOptions: ChoiceOption[] = allOptions
    .filter((o) => !NON_RESPONSE.has(o.id))
    .map((o) => ({ id: o.id, label: t(o.labelKey), ...(o.helpKey && t.has(o.helpKey) ? { help: t(o.helpKey) } : {}) }));
  const unknownOpt = allOptions.find((o) => o.id === UNKNOWN);
  const preferOpt = allOptions.find((o) => o.id === PREFER_NOT);

  const [single, setSingle] = useState<string | null>(typeof initial === "string" && !NON_RESPONSE.has(initial) ? initial : null);
  const [multi, setMulti] = useState<string[]>(Array.isArray(initial) ? initial.filter((x) => !NON_RESPONSE.has(x)) : []);
  const [grid, setGrid] = useState<Record<string, string>>(() =>
    initial && typeof initial === "object" && !Array.isArray(initial) ? { ...initial } : Object.fromEntries((q.biomarkers ?? []).map((b) => [b, UNKNOWN])),
  );

  useEffect(() => {
    if (!autoFocus) return;
    // Text inputs get focus directly; choice questions focus the legend so the question is read first.
    const input = rootRef.current?.querySelector<HTMLElement>('input[type="search"], input[inputmode="numeric"]');
    (input ?? legendRef.current)?.focus({ preventScroll: true });
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [autoFocus]);

  function commit(e?: FormEvent) {
    e?.preventDefault();
    if (q.type === "single") {
      if (!single) return setError(t("questionnaire.ui.chooseOne"));
      onAnswer(single);
    } else if (q.type === "multi") {
      if (multi.length === 0) return setError(t("questionnaire.ui.chooseAtLeastOne"));
      onAnswer(multi);
    } else if (q.type === "biomarker_grid") {
      onAnswer(grid);
    }
  }

  const label = t(variantKey(t, q.labelKey, caregiver));
  const help = q.helpKey && t.has(q.helpKey) ? t(variantKey(t, q.helpKey, caregiver)) : null;
  const aboutKey = `questionnaire.ui.about.${q.id}`;
  const about = t.has(aboutKey) ? t(aboutKey) : null;
  const essentialStep = essential ? ESSENTIAL_IDS.indexOf(q.id as (typeof ESSENTIAL_IDS)[number]) + 1 : 0;
  const why = q.whyKey && t.has(q.whyKey) ? t(q.whyKey) : null;
  const narrowed = impact && impact.narrowedTo !== null && impact.narrowedTo < impact.total ? impact : null;
  const exclusive: Record<string, string[]> = Object.fromEntries(allOptions.filter((o) => o.exclusiveWith).map((o) => [o.id, o.exclusiveWith ?? []]));
  const describedBy = [help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;

  let body: ReactNode;
  switch (q.type) {
    case "group_picker":
      body = <CancerTypeInput onAnswer={(v: CancerGroupId) => onAnswer(v)} />;
      break;
    case "age":
      body = <AgeInput initial={typeof initial === "number" ? initial : undefined} onAnswer={(v) => onAnswer(v)} />;
      break;
    case "zip":
      body = <ZipInput initial={typeof initial === "string" ? initial : undefined} onAnswer={(v) => onAnswer(v)} />;
      break;
    case "travel":
      body = <TravelInput label={label} onAnswer={(v) => onAnswer(v ?? "anywhere")} />; // "anywhere" (not null: null means deferred)
      break;
    case "single":
      body = (
        <SingleChoice
          name={name}
          options={choiceOptions}
          value={single}
          describedBy={describedBy}
          onChange={(id) => {
            setSingle(id);
            setError(null);
          }}
          onPick={(id) => onAnswer(id)}
        />
      );
      break;
    case "multi":
      body = (
        <MultiChoice
          options={choiceOptions}
          value={multi}
          exclusive={exclusive}
          describedBy={describedBy}
          onChange={(next) => {
            setMulti(next);
            setError(null);
          }}
        />
      );
      break;
    case "biomarker_grid":
      body = <BiomarkerGrid ids={q.biomarkers ?? []} value={grid} onChange={setGrid} />;
      break;
  }

  const fieldset = (
    <fieldset aria-describedby={essential ? undefined : describedBy} className="min-w-0 space-y-3">
      <legend className="float-start w-full">
        <span ref={legendRef} tabIndex={-1} className="block text-[1.375rem] leading-snug font-semibold text-balance outline-none sm:text-[1.625rem]">
          {label}
        </span>
      </legend>
      <div className="clear-both flex flex-wrap items-center gap-2 pt-1">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-0.5 text-base",
            q.tier === "deep" ? "border-dashed border-muted-foreground/60 text-muted-foreground" : "border-border bg-muted/60 text-muted-foreground",
          )}
        >
          <span aria-hidden className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
          {essential ? t("questionnaire.ui.essentialStep", { step: essentialStep, total: ESSENTIAL_IDS.length }) : t(`questionnaire.ui.tierBadge.${q.tier}`)}
        </span>
      </div>
      {help && (
        <p id={helpId} className="text-muted-foreground">
          {help}
        </p>
      )}
      {narrowed && (
        <p className="flex items-start gap-2 text-base text-muted-foreground">
          <Lightbulb aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
          {t("questionnaire.ui.narrow", { total: narrowed.total.toLocaleString(t.locale), count: (narrowed.narrowedTo ?? 0).toLocaleString(t.locale) })}
        </p>
      )}
      {body}
      {(why || about) && (
        <details className="group rounded-2xl border border-border bg-muted/40 transition-colors open:bg-muted/60">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 font-medium [&::-webkit-details-marker]:hidden">
            {about ? t("questionnaire.ui.whyAskAbout") : t("questionnaire.ui.whyAsk")}
            <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform duration-300 group-open:rotate-180" />
          </summary>
          <div className="space-y-2 px-4 pb-3">
            {why && <p>{why}</p>}
            {about && (
              <p>
                <span className="font-medium">{t("questionnaire.ui.aboutTitle")} </span>
                {about}
              </p>
            )}
          </div>
        </details>
      )}
      {error && (
        <p id={errId} role="alert" className="text-base text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );

  const nonResponse = essential ? null : (
    <div className="space-y-2 border-t border-border pt-4">
      <div role="group" aria-label={t("questionnaire.ui.nonResponseGroup")} className="flex flex-wrap gap-2">
        <ChipButton pressed={initial === UNKNOWN} onClick={() => onAnswer(UNKNOWN)}>
          {q.type === "biomarker_grid" ? t("questionnaire.ui.biomarkerAllUnknown") : unknownOpt ? t(unknownOpt.labelKey) : t("questionnaire.ui.notSure")}
        </ChipButton>
        <ChipButton pressed={initial === SKIP} onClick={() => onAnswer(SKIP)}>
          {t("questionnaire.ui.skip")}
        </ChipButton>
        {(q.sensitive || preferOpt) && (
          <ChipButton pressed={initial === PREFER_NOT} onClick={() => onAnswer(PREFER_NOT)}>
            {preferOpt ? t(preferOpt.labelKey) : t("questionnaire.ui.preferNot")}
          </ChipButton>
        )}
        {q.cost === 3 && (
          <ChipButton pressed={initial === null || initial === DEFER} onClick={() => onAnswer(DEFER)}>
            {t("questionnaire.ui.doctorLater")}
          </ChipButton>
        )}
      </div>
      <p className="text-base text-muted-foreground">
        {t("questionnaire.ui.nonResponseHint")}
        {q.type === "single" && choiceOptions.length > 1 && <span className="hidden sm:inline"> {t("questionnaire.ui.shortcutHint", { max: choiceOptions.length })}</span>}
      </p>
    </div>
  );

  const needsContinue = q.type === "single" || q.type === "multi" || q.type === "biomarker_grid";
  const bar =
    onBack || needsContinue ? (
      <div className="sticky bottom-0 z-10 -mx-5 mt-2 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-5 py-3 backdrop-blur-xl supports-[backdrop-filter]:bg-card/75 sm:static sm:mx-0 sm:rounded-none sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none">
        {onBack ? (
          <Button type="button" variant="outline" onClick={onBack} className="min-h-11">
            <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
            {m.common.back}
          </Button>
        ) : (
          <span />
        )}
        {needsContinue && (
          <Button type="submit" size="lg" className="min-h-11 px-7">
            {m.common.continue}
          </Button>
        )}
      </div>
    ) : null;

  // Keyboard shortcut: press 1-9 to choose that option (single choice only), then it answers like a tap.
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (q.type !== "single" || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    const target = e.target as HTMLElement;
    if (!Number.isInteger(n) || n < 1 || n > choiceOptions.length || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && (target as HTMLInputElement).type !== "radio") return;
    e.preventDefault();
    const opt = choiceOptions[n - 1];
    if (opt) onAnswer(opt.id);
  }

  return (
    <section ref={rootRef} aria-label={label} data-question={q.id} onKeyDown={onKeyDown} className="tb-surface animate-enter scroll-mt-28 space-y-4 rounded-3xl p-5 sm:p-7">
      {needsContinue ? (
        <form onSubmit={commit} noValidate className="space-y-4">
          {fieldset}
          {nonResponse}
          {bar}
        </form>
      ) : (
        <>
          {fieldset}
          {nonResponse}
          {bar}
        </>
      )}
      {extra}
    </section>
  );
}
