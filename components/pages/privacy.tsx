"use client";

import Link from "next/link";
import { ArrowRight, Check, X } from "lucide-react";
import { useMessages } from "@/components/i18n";
import { PageHead } from "@/components/site/page-head";
import { ProseBlock, ProseFrame } from "./prose";

/** Checked list on a raised card: what happens, item by item. */
function CheckCard({ items }: { items: readonly string[] }) {
  return (
    <ul className="tb-surface tb-spec divide-y divide-border rounded-2xl px-5 py-1">
      {items.map((i) => (
        <li key={i} className="flex items-start gap-3 py-3.5">
          <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrivacyPage() {
  const all = useMessages();
  const m = all.privacy;
  const blocks = [
    { title: m.browserTitle },
    { title: m.aiTitle },
    { title: m.qaTitle },
    { title: m.providersTitle },
    { title: m.noTrackingTitle },
    { title: m.storedTitle },
    { title: m.deviceTitle },
  ].map((b, i) => ({ id: `section-${i + 1}`, label: b.title }));
  const id = (n: number) => blocks[n - 1]!.id;
  return (
    <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pt-10 pb-24 sm:px-6 sm:pt-16 sm:pb-32">
      <PageHead title={m.title} intro={m.intro} className="max-w-5xl" />
      <ProseFrame items={blocks} label={m.title}>
        <ProseBlock id={id(1)} n={1} title={m.browserTitle}>
          <p>{m.browserBody}</p>
          <CheckCard items={m.browserItems} />
        </ProseBlock>
        <ProseBlock id={id(2)} n={2} title={m.aiTitle}>
          <p>{m.aiBody}</p>
          <CheckCard items={m.aiItems} />
          <p className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 font-medium">
            <span aria-hidden className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <X className="size-3.5" strokeWidth={3} />
            </span>
            {m.aiNever}
          </p>
        </ProseBlock>
        <ProseBlock id={id(3)} n={3} title={m.qaTitle}>
          <p>{m.qaBody}</p>
        </ProseBlock>
        <ProseBlock id={id(4)} n={4} title={m.providersTitle}>
          <p>{m.providersBody}</p>
        </ProseBlock>
        <ProseBlock id={id(5)} n={5} title={m.noTrackingTitle}>
          <p>{m.noTrackingBody}</p>
        </ProseBlock>
        <ProseBlock id={id(6)} n={6} title={m.storedTitle}>
          <p>{m.storedBody}</p>
        </ProseBlock>
        <ProseBlock id={id(7)} n={7} title={m.deviceTitle}>
          <p>{m.deviceBody}</p>
        </ProseBlock>
        <div className="space-y-6 border-t border-foreground/12 pt-8">
          <Link href="/privacy-policy/" className="group/pl inline-flex items-center gap-2 text-lg font-medium text-primary underline underline-offset-4">
            {m.policyLink}
            <ArrowRight aria-hidden className="size-4 transition-transform duration-300 group-hover/pl:translate-x-1 rtl:-scale-x-100 rtl:group-hover/pl:-translate-x-1" />
          </Link>
          <p className="text-muted-foreground">{all.disclaimer.text}</p>
        </div>
      </ProseFrame>
    </main>
  );
}
