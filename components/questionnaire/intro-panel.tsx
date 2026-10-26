"use client";

import { ChevronDown, Clock, FlaskConical, HeartHandshake, Lock, SkipForward, Sparkles } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useKeyT } from "./t";

/**
 * First thing a patient sees: what this is, how long it takes, what stays on the device, and that every
 * optional question can be skipped. The caregiver switch only changes wording; no identity is stored.
 */
export function IntroPanel({ caregiver, onCaregiver, onSample }: { caregiver: boolean; onCaregiver: (v: boolean) => void; onSample?: () => void }) {
  const t = useKeyT();
  const id = useId();
  const items = [
    { Icon: Clock, text: t("questionnaire.ui.introTime") },
    { Icon: SkipForward, text: t("questionnaire.ui.introSkip") },
    { Icon: Lock, text: t("questionnaire.ui.introPrivate") },
    { Icon: Sparkles, text: t("questionnaire.ui.introFree") },
  ];
  const tiles = items.map(({ Icon, text }) => (
    <li key={text} className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/50 p-3.5">
      <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.5),0_4px_10px_-6px_var(--iris)]">
        <Icon className="size-4" />
      </span>
      <span className="pt-1 leading-snug">{text}</span>
    </li>
  ));
  return (
    <section aria-labelledby={`${id}-t`} className="tb-surface animate-enter relative overflow-hidden rounded-3xl p-5 sm:p-7">
      <div aria-hidden className="tb-ambient pointer-events-none absolute inset-x-0 top-0 h-40 opacity-70" />
      <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={`${id}-t`} className="text-[1.75rem] leading-[1.02] font-bold [font-stretch:72%] sm:text-[2rem]">
            {t("questionnaire.ui.introTitle")}
          </h2>
          <p className="mt-2 text-muted-foreground">{t("questionnaire.ui.introLead")}</p>
        </div>
        {/* Demo shortcut: a fictional patient's answers, clearly labelled, so a first visit reaches results in one click.
            Left out on the demo server, whose start screen offers it separately. */}
        {onSample && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-end">
            <Button variant="outline" onClick={onSample} className="min-h-11">
              <FlaskConical aria-hidden />
              {t("questionnaire.ui.sampleButton")}
            </Button>
            <span className="text-base text-muted-foreground">{t("questionnaire.ui.sampleQuick")}</span>
          </div>
        )}
      </div>
      {/* Reassurances: a grid from tablet up; on a phone one line that opens, so the first question stays near the top. */}
      <ul className="relative mt-5 hidden gap-3 sm:grid sm:grid-cols-2">{tiles}</ul>
      <details className="group relative mt-3 sm:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/50 px-3.5 py-2.5 font-medium [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <Clock aria-hidden className="size-4 shrink-0 text-primary" />
            {t("questionnaire.ui.introTime")}
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="mt-3 grid gap-3">{tiles}</ul>
      </details>
      {/* A real checkbox, drawn as a switch: it only changes wording, nothing is stored about anyone. */}
      <label className="relative mt-3 flex min-h-11 cursor-pointer items-center gap-4 rounded-2xl border border-border bg-card px-4 py-2.5 sm:mt-4 sm:py-3 transition-colors hover:border-primary/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-medium">
            <HeartHandshake aria-hidden className="size-4 shrink-0 text-primary" />
            {t("questionnaire.ui.caregiverToggle")}
          </span>
          <span className="hidden text-base text-muted-foreground sm:block">{t("questionnaire.ui.caregiverHelp")}</span>
        </span>
        {/* The real checkbox lies, invisible, exactly over the drawn switch, so pointer, keyboard and tests all hit it. */}
        <span className="relative inline-flex shrink-0">
          <input
            type="checkbox"
            checked={caregiver}
            onChange={(e) => onCaregiver(e.target.checked)}
            className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
          />
          <span
            aria-hidden
            className="inline-flex h-7 w-12 items-center rounded-full border border-input bg-muted p-0.5 shadow-[inset_0_1px_3px_oklch(0.2_0.06_295/0.2)] transition-colors duration-300 peer-checked:border-primary peer-checked:bg-primary peer-checked:[&>span]:translate-x-5 rtl:peer-checked:[&>span]:-translate-x-5"
          >
            <span className="size-[1.375rem] rounded-full bg-card shadow-[inset_0_1px_0_oklch(1_0_0),0_1px_3px_oklch(0.2_0.06_295/0.4)] transition-transform duration-300 ease-[cubic-bezier(0.2,1.4,0.4,1)]" />
          </span>
        </span>
      </label>
    </section>
  );
}
