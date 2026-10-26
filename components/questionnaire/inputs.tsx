"use client";

import { Check } from "lucide-react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BIOMARKERS } from "@/config/biomarkers";
import { PICKABLE_GROUPS, type CancerGroupId } from "@/config/cancer-groups";
import { format, useMessages, type Messages } from "@/components/i18n";
import { inputClass } from "@/components/chat/primitives";
import { Button } from "@/components/ui/button";
import { lookupZip } from "@/lib/data/loader";
import { AgeSchema, TRAVEL_OPTIONS, ZipSchema } from "@/lib/types/intake";
import { cn } from "@/lib/utils";
import { BIOMARKER_ANSWERS, UNKNOWN, type BiomarkerAnswer } from "./contract";
import { useKeyT } from "./t";

/**
 * Shared chip look: 44px+ targets, 16px text, visible focus, state not shown by color alone (check mark / pressed).
 * Chips are tactile keys (.tb-key): raised at rest, they sink when pressed and light up when chosen.
 */
const chipClass = "tb-key inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-start text-base leading-snug";
const chipIdle = "";
const chipOn = "tb-key-on";
const focusRing = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring";

export function travelLabel(miles: number | null, m: Messages): string {
  return miles === null ? m.chat.travelAnywhere : format(m.chat.travelOption, { miles });
}

/** Translated name when the label is a phrase; gene/protein symbols (HER2, EGFR, ...) stay as-is. */
export function biomarkerLabel(id: string, m?: Messages): string {
  const names: Partial<Record<string, string>> | undefined = m?.biomarkerNames;
  return names?.[id] ?? BIOMARKERS.find((b) => b.id === id)?.label ?? id;
}

/* ---------- Essentials ---------- */

export function CancerTypeInput({ onAnswer }: { onAnswer: (v: CancerGroupId) => void }) {
  const m = useMessages();
  const [query, setQuery] = useState("");
  const inputId = useId();
  const hintId = useId();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PICKABLE_GROUPS;
    return PICKABLE_GROUPS.filter(
      (g) => g.label.toLowerCase().includes(q) || m.cancerGroups[g.id].toLowerCase().includes(q) || g.synonyms.some((s) => s.toLowerCase().includes(q)),
    );
  }, [query, m]);
  const options = [...filtered.map((g) => ({ value: g.id, label: m.cancerGroups[g.id] })), { value: "other" as const, label: m.chat.cancerOther }];
  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="sr-only">
        {m.chat.cancerSearch}
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter picks the top match, so keyboard users can type and confirm.
          const first = filtered[0];
          if (e.key === "Enter" && query.trim() && first) {
            e.preventDefault();
            onAnswer(first.id);
          }
        }}
        placeholder={m.chat.cancerSearch}
        aria-describedby={hintId}
        autoComplete="off"
        className={inputClass}
      />
      <p id={hintId} className="text-base text-muted-foreground">
        {m.chat.cancerSearchHint}
      </p>
      {filtered.length === 0 && <p className="text-muted-foreground">{m.chat.cancerNoMatch}</p>}
      <div role="group" aria-label={m.chat.labels.cancerType} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => onAnswer(o.value)} className={cn(chipClass, chipIdle)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ZipInput({ initial, onAnswer }: { initial?: string; onAnswer: (zip: string) => void }) {
  const m = useMessages();
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputId = useId();
  const errId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = ZipSchema.safeParse(value.trim());
    if (!parsed.success) return setError(m.chat.zipInvalid);
    setChecking(true);
    setError(null);
    try {
      // Lookup happens on-device from static data; the ZIP is never sent to our backend.
      const found = await lookupZip(parsed.data);
      if (!found) {
        setError(m.chat.zipUnknown);
        return;
      }
    } catch {
      // ZIP table unavailable (offline?): accept the format-valid ZIP; search will retry the lookup.
    } finally {
      setChecking(false);
    }
    onAnswer(parsed.data);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <label htmlFor={inputId} className="block font-medium">
        {m.chat.zipLabel}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, "").slice(0, 5));
            setError(null);
          }}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={`${inputClass} max-w-40 tracking-widest`}
        />
        <Button type="submit" disabled={checking} className="h-12 px-5">
          {m.common.continue}
        </Button>
      </div>
      <p id={errId} aria-live="polite" className="min-h-6 text-base text-destructive">
        {checking ? <span className="text-muted-foreground">{m.chat.zipChecking}</span> : error}
      </p>
    </form>
  );
}

/** Age 18-110; under 18 shows the respectful pediatric-resources message and stops the flow. */
export function AgeInput({ initial, onAnswer }: { initial?: number; onAnswer: (age: number) => void }) {
  const m = useMessages();
  const [value, setValue] = useState(initial === undefined ? "" : String(initial));
  const [error, setError] = useState<string | null>(null);
  const [minor, setMinor] = useState(false);
  const inputId = useId();
  const errId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() !== "" && Number.isInteger(n) && n >= 0 && n < 18) {
      setMinor(true);
      return;
    }
    const parsed = AgeSchema.safeParse(n);
    if (value.trim() === "" || !parsed.success) return setError(m.chat.ageInvalid);
    onAnswer(parsed.data);
  }

  if (minor) {
    return (
      <div role="alert" className="tb-surface-flat space-y-3 rounded-2xl p-5">
        <h3 className="text-lg font-semibold">{m.chat.under18Title}</h3>
        <p>{m.chat.under18Body}</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://clinicaltrials.gov/search?cond=Cancer&aggFilters=ages:child,status:rec"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-4"
          >
            {m.chat.under18Link} <span className="sr-only">{m.common.opensNewTab}</span>
          </a>
          <Button
            variant="outline"
            onClick={() => {
              setMinor(false);
              setValue("");
            }}
          >
            {m.chat.under18Change}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <label htmlFor={inputId} className="block font-medium">
        {m.chat.ageLabel}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, "").slice(0, 3));
            setError(null);
          }}
          inputMode="numeric"
          maxLength={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          className={`${inputClass} max-w-28`}
        />
        <Button type="submit" className="h-12 px-5">
          {m.common.continue}
        </Button>
      </div>
      <p id={errId} aria-live="polite" className="min-h-6 text-base text-destructive">
        {error}
      </p>
    </form>
  );
}

export function TravelInput({ label, onAnswer }: { label: string; onAnswer: (miles: number | null) => void }) {
  const m = useMessages();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {TRAVEL_OPTIONS.map((t) => (
        <button key={String(t)} type="button" onClick={() => onAnswer(t)} className={cn(chipClass, chipIdle)}>
          {travelLabel(t, m)}
        </button>
      ))}
    </div>
  );
}

/* ---------- Adaptive question bodies (rendered inside the card's fieldset) ---------- */

export interface ChoiceOption {
  id: string;
  label: string;
  help?: string;
}

/**
 * Single choice as a native radio group (arrow keys move the selection; Space/Enter + Continue confirm).
 * A pointer click (detail > 0) answers at once, like a quick-reply chip.
 */
export function SingleChoice({
  name,
  options,
  value,
  onChange,
  onPick,
  describedBy,
}: {
  name: string;
  options: readonly ChoiceOption[];
  value: string | null;
  onChange: (id: string) => void;
  onPick: (id: string) => void;
  describedBy?: string;
}) {
  return (
    <div role="radiogroup" aria-describedby={describedBy} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <label key={o.id} className={cn(chipClass, focusRing, on ? chipOn : chipIdle)}>
            <input
              type="radio"
              name={name}
              value={o.id}
              checked={on}
              onChange={() => onChange(o.id)}
              onClick={(e) => {
                if (e.detail > 0) onPick(o.id);
              }}
              className="sr-only"
            />
            <span aria-hidden className={cn("tb-pop size-3 shrink-0 rounded-full border-2", on ? "border-primary-foreground bg-primary-foreground" : "border-muted-foreground")} />
            <span>
              {o.label}
              {o.help && <span className={cn("block", on ? "text-primary-foreground" : "text-muted-foreground")}>{o.help}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function MultiChoice({
  options,
  value,
  onChange,
  exclusive,
  describedBy,
}: {
  options: readonly ChoiceOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Option id -> ids it clears when chosen (and that clear it). */
  exclusive: Readonly<Record<string, readonly string[]>>;
  describedBy?: string;
}) {
  function toggle(id: string) {
    if (value.includes(id)) return onChange(value.filter((x) => x !== id));
    const clears = new Set(exclusive[id] ?? []);
    for (const [other, list] of Object.entries(exclusive)) if (list.includes(id)) clears.add(other);
    onChange([...value.filter((x) => !clears.has(x)), id]);
  }
  return (
    <div role="group" aria-describedby={describedBy} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <label key={o.id} className={cn(chipClass, focusRing, on ? chipOn : chipIdle)}>
            <input type="checkbox" checked={on} onChange={() => toggle(o.id)} className="sr-only" />
            <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded border-2", on ? "border-primary-foreground" : "border-muted-foreground")}>
              {on && <Check className="tb-pop size-3" strokeWidth={3} />}
            </span>
            <span>
              {o.label}
              {o.help && <span className={cn("block", on ? "text-primary-foreground" : "text-muted-foreground")}>{o.help}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * Biomarker grid: one radio group per marker, each with a row label (spec §5.2). Everything starts at "Don't know",
 * so a patient who has no report can skip the whole thing (the "I don't know any of these" chip below). Long lists
 * get a search box; hidden rows keep their answers. Name above the choices so it fits at 320 px.
 */
export function BiomarkerGrid({
  ids,
  value,
  onChange,
}: {
  ids: readonly string[];
  value: Readonly<Record<string, string>>;
  onChange: (next: Record<string, string>) => void;
}) {
  const m = useMessages();
  const t = useKeyT();
  const base = useId();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const statusLabel = (s: BiomarkerAnswer) => t(`questionnaire.ui.biomarker.${s}`);
  const q = query.trim().toLowerCase();
  const shown = q ? ids.filter((id) => `${id} ${biomarkerLabel(id, m)}`.toLowerCase().includes(q)) : ids;
  const answered = ids.filter((id) => (value[id] ?? UNKNOWN) !== UNKNOWN).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base text-muted-foreground" role="status" aria-live="polite">
          {t("questionnaire.ui.biomarkerCount", { answered, total: ids.length })}
        </p>
      </div>
      {ids.length > 8 && (
        <div>
          <label htmlFor={searchId} className="sr-only">
            {t("questionnaire.ui.biomarkerSearch")}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("questionnaire.ui.biomarkerSearch")}
            autoComplete="off"
            className={inputClass}
          />
        </div>
      )}
      {shown.length === 0 && <p className="text-muted-foreground">{t("questionnaire.ui.biomarkerNone")}</p>}
      <ul aria-label={t("questionnaire.ui.biomarkerCaption")} className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background/40">
        {shown.map((id) => {
          const name = biomarkerLabel(id, m);
          const current = value[id] ?? UNKNOWN;
          return (
            <li key={id} className={cn("space-y-2 px-3 py-3 transition-colors duration-300 sm:px-4", current !== UNKNOWN && "bg-secondary/50")}>
              <p id={`${base}-${id}`} className="font-medium break-words">
                {name}
              </p>
              <div role="radiogroup" aria-labelledby={`${base}-${id}`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {BIOMARKER_ANSWERS.map((s) => {
                  const on = current === s;
                  return (
                    <label key={s} className={cn(chipClass, focusRing, "min-h-11 justify-start px-3 max-sm:rounded-xl", on ? chipOn : chipIdle)}>
                      <input type="radio" name={`${base}-${id}`} value={s} checked={on} onChange={() => onChange({ ...value, [id]: s })} className="sr-only" />
                      <span aria-hidden className={cn("tb-pop size-3 shrink-0 rounded-full border-2", on ? "border-primary-foreground bg-primary-foreground" : "border-muted-foreground")} />
                      {statusLabel(s)}
                    </label>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChipButton({ children, onClick, pressed }: { children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} className={cn(chipClass, pressed ? chipOn : chipIdle)}>
      {children}
    </button>
  );
}
