import type { Messages } from "@/components/i18n";
import type { CancerGroupId } from "@/config/cancer-groups";
import { UNKNOWN, nonResponseKind, type AnswerValue, type QuestionDef, type QuestionnaireState } from "./contract";
import { biomarkerLabel, travelLabel } from "./inputs";
import type { KeyT } from "./t";

const NON_RESPONSE_LABEL = {
  unknown: "questionnaire.ui.answerNotSure",
  skip: "questionnaire.ui.answerSkipped",
  prefer_not: "questionnaire.ui.answerPreferNot",
  deferred: "questionnaire.ui.answerDeferred",
} as const;

/** Plain-language display of one stored answer (transcript bubbles, summary rows). */
export function answerText(q: QuestionDef, state: QuestionnaireState, t: KeyT, m: Messages): string {
  const kind = nonResponseKind(state, q.id);
  if (kind) return t(NON_RESPONSE_LABEL[kind]);
  const v: AnswerValue | undefined = state.answers[q.id];
  if (v === undefined) return "";
  const optLabel = (id: string) => {
    const o = q.options?.find((x) => x.id === id);
    return o ? t(o.labelKey) : id;
  };
  switch (q.type) {
    case "group_picker":
      return m.cancerGroups[v as CancerGroupId] ?? String(v);
    case "age":
    case "zip":
      return String(v);
    case "travel":
      return travelLabel(typeof v === "number" ? v : null, m);
    case "single":
      return typeof v === "string" ? optLabel(v) : "";
    case "multi":
      return Array.isArray(v) ? v.map(optLabel).join(", ") : "";
    case "biomarker_grid": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return "";
      const known = Object.entries(v).filter(([, s]) => s !== UNKNOWN);
      if (known.length === 0) return t("questionnaire.ui.biomarker.unknown");
      return known.map(([id, s]) => `${biomarkerLabel(id, m)}: ${t(`questionnaire.ui.biomarker.${s}`)}`).join(" · ");
    }
  }
}
