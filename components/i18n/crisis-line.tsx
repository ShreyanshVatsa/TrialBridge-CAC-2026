"use client";

import { Phone } from "lucide-react";
import { getLocale } from "@/config/locales";
import { useT } from "./index";

/** Wrap "988" and "911" in the translated sentence as tel: links. */
function withPhoneLinks(text: string) {
  return text.split(/(988|911)/).map((part, i) =>
    part === "988" || part === "911" ? (
      <a key={i} href={`tel:${part}`} className="font-semibold underline underline-offset-4">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/**
 * Always-visible U.S. crisis resource line (docs/dev/QUESTIONNAIRE_SPEC.md section 6.7). Shown on every Q&A panel
 * and results page in every language. For machine-translated languages the English sentence is shown
 * as well, so the numbers can never be lost in translation. In Q&A (`context="qa"`) locales without a
 * reviewed crisis lexicon also state that the numbers above are the way to get urgent help.
 */
export function CrisisLine({ context = "results" }: { context?: "qa" | "results" }) {
  const { t, lang, dir } = useT();
  const def = getLocale(lang);
  const showEnglish = lang !== "en";
  const showUrgent = context === "qa" && !(def?.crisisLexicon ?? false);
  return (
    <aside role="note" aria-label={t("i18n.crisisLabel")} data-testid="crisis-line" className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-3 text-sm">
      <Phone className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="space-y-1" dir={dir}>
        <p>{withPhoneLinks(t("i18n.crisisLine"))}</p>
        {showEnglish && (
          <p lang="en" dir="ltr" className="text-muted-foreground">
            {withPhoneLinks(t("i18n.crisisEnglish").replace(/^In English: /, ""))}
          </p>
        )}
        {showUrgent && <p className="font-medium">{t("i18n.crisisUrgent")}</p>}
      </div>
    </aside>
  );
}
