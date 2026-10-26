"use client";

import { Check, Globe } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LOCALES } from "@/config/locales";
import { filterLocales } from "@/lib/i18n/search";
import { setLanguage, useLanguage, useT } from "./index";

/**
 * Searchable language picker (ARIA 1.2 combobox with a listbox popup). Lists the native name first and
 * the English name second, matches on both, and shows a Reviewed / Machine-translated badge.
 */
export function LanguagePicker({ className = "" }: { className?: string }) {
  const { t } = useT();
  const lang = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const results = useMemo(() => filterLocales(LOCALES, query), [query]);
  const current = LOCALES.find((l) => l.tag === lang) ?? LOCALES[0]!;

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  };
  const choose = (tag: string) => {
    setLanguage(tag);
    close(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Home") {
      setActive(0);
    } else if (e.key === "End") {
      setActive(Math.max(results.length - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active];
      if (pick) choose(pick.tag);
    }
  };

  const optionId = (tag: string) => `${uid}-opt-${tag}`;
  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("i18n.pickerLabel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setActive(Math.max(LOCALES.findIndex((l) => l.tag === lang), 0));
          setOpen((o) => !o);
        }}
        className="flex h-11 items-center gap-2 rounded-full px-3 text-sm text-foreground transition-colors hover:bg-muted sm:text-base"
      >
        <Globe className="size-4 text-muted-foreground" aria-hidden />
        <span lang={current.tag}>{current.nativeName}</span>
      </button>
      {open && (
        <div role="dialog" aria-label={t("i18n.pickerLabel")} className="tb-glass-panel tb-pop-in absolute end-0 z-40 bg-popover mt-3 w-[min(20rem,calc(100vw-2rem))] origin-top-right rounded-3xl p-2 rtl:origin-top-left" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? optionId(results[active]!.tag) : undefined}
            aria-label={t("i18n.searchLabel")}
            placeholder={t("i18n.searchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full rounded-2xl border border-input bg-background/80 px-4 text-base shadow-[inset_0_1px_2px_oklch(0.2_0.06_295/0.08)]"
          />
          <ul id={listId} role="listbox" aria-label={t("i18n.pickerLabel")} className="mt-2 max-h-[min(22rem,60vh)] overflow-y-auto">
            {results.map((l, i) => {
              const selected = l.tag === lang;
              return (
                <li
                  key={l.tag}
                  id={optionId(l.tag)}
                  role="option"
                  aria-selected={selected}
                  data-locale={l.tag}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(l.tag)}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 transition-colors ${i === active ? "bg-muted" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span lang={l.tag} dir={l.dir} className="font-medium">
                      {l.nativeName}
                    </span>
                    <span className="text-muted-foreground"> · {l.englishName}</span>
                    <span className="block text-xs text-muted-foreground">{l.baseStatus === "reviewed" ? t("i18n.statusReviewed") : t("i18n.statusMachine")}</span>
                  </span>
                  {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                </li>
              );
            })}
            {results.length === 0 && (
              <li role="presentation" className="px-3 py-3 text-sm text-muted-foreground">
                {t("i18n.noResults")}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
