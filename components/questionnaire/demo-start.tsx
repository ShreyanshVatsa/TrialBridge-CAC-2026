"use client";

import { ClipboardList, FlaskConical, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { useKeyT } from "./t";

/**
 * Demo start screen (local demo server only): the two ways in, kept apart so a recording can show the questionnaire,
 * come back here, then run the sample patient.
 */
export function DemoStart({ onQuestions, onSample }: { onQuestions: () => void; onSample: () => void }) {
  const t = useKeyT();
  const id = useId();
  const choices: { Icon: LucideIcon; title: string; text: string; onClick: () => void }[] = [
    { Icon: ClipboardList, title: t("questionnaire.ui.demoQuestionsTitle"), text: t("questionnaire.ui.demoQuestionsText"), onClick: onQuestions },
    { Icon: FlaskConical, title: t("questionnaire.ui.demoSampleTitle"), text: t("questionnaire.ui.demoSampleText"), onClick: onSample },
  ];
  return (
    <section aria-labelledby={`${id}-t`} className="tb-surface animate-enter relative overflow-hidden rounded-3xl p-5 sm:p-7">
      <div aria-hidden className="tb-ambient pointer-events-none absolute inset-x-0 top-0 h-40 opacity-70" />
      <div className="relative">
        <h2 id={`${id}-t`} className="text-[1.75rem] leading-[1.02] font-bold [font-stretch:72%] sm:text-[2rem]">
          {t("questionnaire.ui.demoTitle")}
        </h2>
        <p className="mt-2 text-muted-foreground">{t("questionnaire.ui.demoLead")}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {choices.map(({ Icon, title, text, onClick }) => (
            <button
              key={title}
              type="button"
              onClick={onClick}
              className="group flex min-h-40 flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-start shadow-[var(--shadow-2,0_8px_20px_-12px_var(--iris))] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.5),0_4px_10px_-6px_var(--iris)]">
                <Icon className="size-5" />
              </span>
              <span className="text-lg font-semibold">{title}</span>
              <span className="text-muted-foreground">{text}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
