"use client";

import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";
import { format, useLanguage, useMessages, localeFor } from "@/components/i18n";
import { formatDate } from "@/components/format";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EvalSummary } from "./eval-summary";
import { ProseHeading, ProsePage } from "./prose";
import { Magnetic } from "@/components/landing/magnetic";
import { FOUNDER_STORY } from "@/content/founder-story";

/** Partner contact address; set NEXT_PUBLIC_PARTNER_EMAIL at build time. */
const PARTNER_EMAIL = (process.env.NEXT_PUBLIC_PARTNER_EMAIL ?? "").trim();
const PARTNER_EMAIL_VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(PARTNER_EMAIL);
/** Date the policy drafts were last edited. */
const POLICY_DATE = "2026-10-07";

export function ForSitesPage() {
  const m = useMessages().pages.forSites;
  return (
    <ProsePage title={m.title} intro={m.intro} sections={m.sections}>
      {/* The same lavender band as the landing's sites section, as a closing card. */}
      <section className="tb-reveal relative overflow-hidden rounded-[2rem] bg-lavender p-8 text-center text-ink shadow-[inset_0_1px_0_oklch(1_0_0/0.6),0_30px_60px_-30px_var(--iris)] sm:p-12">
        <div aria-hidden className="pointer-events-none absolute inset-x-[10%] -top-24 h-48 rounded-full bg-[radial-gradient(closest-side,oklch(1_0_0/0.55),transparent)]" />
        {PARTNER_EMAIL_VALID ? (
          <>
            <Magnetic>
              <a
                href={`mailto:${PARTNER_EMAIL}?subject=${encodeURIComponent(m.mailSubject)}`}
                className="relative inline-flex min-h-14 items-center gap-2 rounded-full bg-ink px-7 text-lg font-medium text-paper shadow-[inset_0_1px_0_oklch(1_0_0/0.18),0_14px_30px_-14px_oklch(0.2_0.06_295/0.8)] transition-transform hover:-translate-y-0.5 focus-visible:outline-ink"
              >
                <Mail aria-hidden className="size-5" />
                {m.cta}
              </a>
            </Magnetic>
            <p className="relative mt-4 text-sm">{m.ctaNote}</p>
          </>
        ) : (
          <span
            aria-disabled="true"
            className="relative inline-flex min-h-14 cursor-not-allowed items-center gap-2 rounded-full border border-ink/30 bg-paper/50 px-7 text-lg font-medium text-ink"
          >
            <Mail aria-hidden />
            {m.ctaSoon}
          </span>
        )}
      </section>
    </ProsePage>
  );
}

export function MethodologyPage() {
  const m = useMessages().pages.methodology;
  return (
    <ProsePage title={m.title} intro={m.intro} sections={m.sections} extraTitles={[m.evalTitle]}>
      <section id={`section-${m.sections.length + 1}`} className="tb-reveal scroll-mt-28 border-t border-foreground/12 pt-8">
        <ProseHeading n={m.sections.length + 1}>{m.evalTitle}</ProseHeading>
        <p className="mt-5 text-[1.0625rem] leading-relaxed">{m.evalBody}</p>
        <EvalSummary />
      </section>
    </ProsePage>
  );
}

export function AboutPage() {
  const m = useMessages().pages.about;
  const story = FOUNDER_STORY.filter((p) => p.trim() !== "");
  return (
    <ProsePage title={m.title} intro={m.intro} sections={m.sections} extraTitles={story.length > 0 ? [m.founderTitle] : []}>
      {story.length > 0 && (
        <section id={`section-${m.sections.length + 1}`} className="tb-reveal scroll-mt-28 border-t border-foreground/12 pt-8">
          <ProseHeading n={m.sections.length + 1}>{m.founderTitle}</ProseHeading>
          <div className="mt-5 space-y-4 text-[1.0625rem] leading-relaxed">
            {story.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      )}
      <Link href="/methodology/" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "group/more min-h-12")}>
        {m.methodologyLink}
        <ArrowRight className="transition-transform duration-300 group-hover/more:translate-x-1 rtl:-scale-x-100 rtl:group-hover/more:-translate-x-1" aria-hidden />
      </Link>
    </ProsePage>
  );
}

export function PolicyPage({ kind }: { kind: "privacyPolicy" | "terms" }) {
  const m = useMessages().pages[kind];
  const lang = useLanguage();
  return <ProsePage draft title={m.title} intro={format(m.intro, { date: formatDate(POLICY_DATE, localeFor(lang)) })} sections={m.sections} />;
}
