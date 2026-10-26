"use client";

import type { ReactNode } from "react";
import { FileWarning } from "lucide-react";
import { useMessages } from "@/components/i18n";
import { PageHead } from "@/components/site/page-head";
import { SectionRail } from "@/components/site/section-rail";

interface ProseSection {
  readonly title: string;
  readonly body: readonly string[];
  readonly items: readonly string[];
}

/** Numbered section heading used by the long-form pages: a condensed numeral hangs beside the title. */
export function ProseHeading({ n, children, id }: { n?: number; children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="flex items-baseline gap-4 text-[clamp(1.75rem,3vw,2.35rem)] leading-[1.02] font-bold [font-stretch:70%]">
      {n !== undefined && (
        <span aria-hidden className="font-heading text-[0.62em] font-extrabold text-primary tabular-nums [font-stretch:62%]">
          {String(n).padStart(2, "0")}
        </span>
      )}
      <span>{children}</span>
    </h2>
  );
}

/** Two-column frame for long pages: sticky contents rail beside a readable column. */
export function ProseFrame({ items, label, children }: { items: readonly { id: string; label: string }[]; label: string; children: ReactNode }) {
  return (
    <div className="mt-14 grid gap-10 sm:mt-20 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
      <SectionRail items={items} label={label} />
      <div className="min-w-0 max-w-[70ch] space-y-14 sm:space-y-16">{children}</div>
    </div>
  );
}

/** One numbered section of a long page. */
export function ProseBlock({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="tb-reveal scroll-mt-28 border-t border-foreground/12 pt-8">
      <ProseHeading n={n} id={`${id}-t`}>
        {title}
      </ProseHeading>
      <div className="mt-5 space-y-4 text-[1.0625rem] leading-relaxed">{children}</div>
    </section>
  );
}

/** Bulleted list with a short violet rule as the marker. */
function RuleList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-3 pt-1">
      {items.map((it) => (
        <li key={it} className="relative ps-6">
          <span aria-hidden className="absolute start-0 top-[0.8em] h-px w-3.5 bg-primary" />
          {it}
        </li>
      ))}
    </ul>
  );
}

/**
 * Long-form content page (methodology, about, policies) rendered from structured messages: an editorial
 * head, then numbered sections beside a sticky contents rail on wide screens. Sections rise in on scroll
 * where the browser has scroll timelines and motion is allowed.
 */
export function ProsePage({
  title,
  intro,
  sections,
  draft = false,
  children,
  before,
  extraTitles = [],
}: {
  title: string;
  intro: string;
  sections: readonly ProseSection[];
  draft?: boolean;
  children?: ReactNode;
  before?: ReactNode;
  /** Titles of sections passed as children after the structured ones; they get rail entries with ids section-N. */
  extraTitles?: readonly string[];
}) {
  const m = useMessages();
  const items = [...sections.map((s) => s.title), ...extraTitles].map((label, i) => ({ id: `section-${i + 1}`, label }));
  return (
    <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-10 pb-24 sm:px-6 sm:pt-16 sm:pb-32">
      {draft && (
        <p role="note" className="mb-10 flex max-w-3xl items-start gap-2 rounded-2xl border border-warn-border bg-warn px-4 py-3 font-medium text-warn-foreground">
          <FileWarning className="mt-1 size-4 shrink-0" aria-hidden />
          {m.pages.draftBanner}
        </p>
      )}
      <PageHead title={title} intro={intro} className="max-w-5xl" />
      <ProseFrame items={items} label={title}>
        {before}
        {sections.map((s, i) => (
          <ProseBlock key={s.title} id={items[i]!.id} n={i + 1} title={s.title}>
            {s.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.items.length > 0 && <RuleList items={s.items} />}
          </ProseBlock>
        ))}
        {children}
      </ProseFrame>
    </main>
  );
}
