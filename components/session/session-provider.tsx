"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { emptyState, type QuestionnaireState } from "@/components/questionnaire/contract";
import type { IntakeAnswers, RankedTrial, SearchOutcome } from "@/lib/types";
import type { CriteriaRanking } from "@/lib/types/criteria";

/**
 * Session state shared across client-side navigation (find -> trial detail -> back).
 * Search results live in memory only. Questionnaire answers are also mirrored to sessionStorage
 * (tab-scoped, cleared when the tab closes) by the questionnaire flow; never localStorage, cookies or a server.
 */
export type AnalysisState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ok"; experimental: boolean }
  | { status: "degraded" };

export interface SearchSession {
  answers: IntakeAnswers;
  outcome: SearchOutcome;
  results: RankedTrial[];
  analysis: AnalysisState;
  /**
   * Per-criterion ranking (lib/match/criteria-rank.ts): per-trial TrialMatchScore + merged labels, the degraded
   * flag and the Find-out priority. `results` is kept in `criteria.order`. Absent before the first ranking.
   */
  criteria?: CriteriaRanking;
  origin: { lat: number; lon: number } | null;
  searchedAt: number;
}

interface SessionValue {
  questionnaire: QuestionnaireState;
  setQuestionnaire: (next: QuestionnaireState) => void;
  session: SearchSession | null;
  setSession: (next: SearchSession | null | ((prev: SearchSession | null) => SearchSession | null)) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireState>(emptyState);
  const [session, setSession] = useState<SearchSession | null>(null);

  const value = useMemo<SessionValue>(
    () => ({
      questionnaire,
      setQuestionnaire,
      session,
      setSession,
    }),
    [questionnaire, session],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
