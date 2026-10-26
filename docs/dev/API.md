# TrialBridge internal API (lib/ for the UI)

All types live in `lib/types` (`import type { ... } from "@/lib/types"`). Config: `config/cancer-groups.ts` (`CANCER_GROUPS`, `PICKABLE_GROUPS`, `getCancerGroup`), `config/biomarkers.ts` (`BIOMARKERS`, `BIOMARKERS_BY_GROUP`).
All functions are browser-safe and client-only (call from `"use client"` components). Nothing here sends ZIP, exact age, or intake text anywhere.

## Intake
- `IntakeAnswersSchema` (zod, `lib/types/intake.ts`): validate the full answer set before searching. Field schemas `ZipSchema`, `AgeSchema`, `TravelMilesSchema` validate single inputs. `TRAVEL_OPTIONS` = `[25, 50, 100, 250, 500, null]` (null = anywhere).
- Cancer type `"other"` means "Other / not sure" (searches all trials). Biomarker question: ask only `BIOMARKERS_BY_GROUP[cancerType]`; skip when empty.

## Data loading (`lib/data/loader.ts`)
- `loadMeta(): Promise<Meta>`: data date, counts per group, versions (for landing stats).
- `loadTrial(nctId: string): Promise<{ card: TrialCard; sites: Site[] } | null>`: trial detail page (`/trial/?id=NCT01234567`). null = unknown ID.
- `lookupZip(zip: string): Promise<{ lat: number; lon: number } | null>`: ZIP centroid (loads one 3-digit-prefix file on demand).
- `sortSitesByDistance(sites: Site[], origin: { lat: number; lon: number } | null): Array<{ site: Site; miles: number | null }>`: nearest first.
- `loadTrials(nctIds: string[]): Promise<Map<string, { card; sites }>>`: several trials at once (per-trial bucket files).
- Internal: `loadManifest()`, `loadShard(...)`, `loadLiteShard(...)` (used by search; UI should not need them).
- All loaders throw `DataLoadError` (`code: "network" | "not_found" | "invalid" | "timeout"`) after retries.

## Matching (`lib/match/search.ts`)
- `searchTrials(answers: IntakeAnswers, opts?: { onProgress?: (p: SearchProgress) => void; signal?: AbortSignal }): Promise<SearchOutcome>`
  - Loads the shard(s), applies hard filters (group, age, distance), hybrid ranks (BM25 + embeddings via Web Worker, RRF k=60), rule pre-check. Returns top 20 `RankedTrial`s (show 10, "show more" for the rest; 15 before v9).
  - `outcome.keywordOnly === true` => embeddings failed/timed out; show the "keyword-only ranking" notice.
- `prefetchSearch(cancerType: CancerGroupId): void`: call as soon as the user picks a cancer type in intake. Downloads that type's shard(s) and loads the embedding model in the worker while the remaining questions are answered (static files only; nothing about the user is sent). Cuts first-search latency substantially.
- `applyAnalysis(results: RankedTrial[], response: AnalyzeResponse): RankedTrial[]`: attaches AI analysis per trial and re-ranks with `lib/match/score.ts`.

## AI analysis (`lib/api/analyze.ts`)
- `requestAnalysis(answers: IntakeAnswers, nctIds: string[], turnstileToken: string, opts?: { signal?: AbortSignal }): Promise<AnalyzeResponse>`
  - Minimizes the profile internally (`minimizeProfile`, `lib/privacy/minimize.ts`). Never throws for AI/network failure: returns `{ status: "degraded", degradedReason }`; show "AI explanations are busy right now. Here are your matches based on trial criteria." `experimental === true` => label Haitian Creole AI output "experimental".
- `getTurnstileToken(container: HTMLElement): Promise<string>` (`lib/api/turnstile.ts`): loads Turnstile and renders an interaction-only widget in `container`; resolves with a token.

## Trial Q&A (`lib/api/ask.ts`, types in `lib/types/ask.ts`)
- `askQuestion(nctId: string, question: string, language: Language, turnstileToken: string, opts?: { signal?: AbortSignal }): Promise<AskResponse>`
  - Get a fresh Turnstile token per question (`getTurnstileToken`). Scrubs personal info client-side first; never throws for AI/network failure.
  - `MAX_QUESTION_CHARS` (300) for the input's maxLength; `questionsRemaining(nctId)` (10 per trial per session) for the counter; `scrubPersonalInfo(text)` if you want to preview removal.
  - Always show the notice "Don't include personal details." `piiRemoved === true` => tell the user some details were removed.
- `AskResponse`: `{ status: "ok" | "degraded", kind: "answer" | "not_in_text" | "refusal" | "crisis" | null, refusalReason?: "off_topic" | "diagnosis" | "treatment_advice" | "eligibility", answer, citations: { section: "inclusion" | "exclusion" | "summary" | "title", number: number | null, quote }[], crisis, piiRemoved, experimental, cached, provider, degradedReason? }`
  - `answer` is already in the user's language (server-written for refusals/crisis). Render `citations[].quote` as English official text with "Inclusion criterion N" etc.
  - `crisis === true` => show crisis resources prominently: U.S. call or text 988 (Suicide & Crisis Lifeline); emergencies 911; encourage contacting their care team.
  - `degradedReason`: "question_limit" => "You've reached the 10-question limit for this trial"; "rate_limited"/"ai_unavailable"/"budget_exhausted"/"invalid_output" => friendly busy message.

## Access Intelligence (`lib/access/access.ts`, data `/data/access.json`, types `lib/types/access.ts`)
- `loadAccess(): Promise<AccessData>` (memoized). `data.dataDate` for the "data as of" label.
- `getSummary(data, { state?, group? }): Counts` => stat cards. `Counts = { trials, anyBarrier, english_required, upper_age_limit, disability_exclusion }`. Use `pct(n, d)` for percentages (show counts next to them).
- `getStateRates(data, { group?, metric? = "any" }): { state, trials, count, rate }[]` => U.S. map (state = postal code, e.g. "TX"; rate is 0..100).
- `getBarrierBreakdown(data, { state?, group? }): { type: "any" | BarrierType, count, rate }[]` => barrier-type chart.
- `getGroupRows(data, state?): { group, trials, anyBarrier, rate }[]` => cancer-type filter list/chart.
- `getSiteTable(data, { state?, group?, metric?, minTrials? = 5, limit? = 100 }): SiteRow[]` => ranked site table (sites with 5+ trials; sorted by barrier rate, then trials). `SiteRow = Counts & { facility, city, state, rate }`.
- Methodology note: "disability exclusion" includes exclusions of people with psychiatric/mental illness or cognitive/physical disability when no medical reason is stated (e.g. "would limit compliance with study requirements").

## Fit/badges
- `FitLevel`: strong | possible | unlikely | unclear. `Assessment`: likely_met | likely_not_met | needs_doctor. Never say "eligible"/"qualify"; say "possible match to discuss with your care team".
- `Barrier.type`: english_required | upper_age_limit | disability_exclusion; `Barrier.quote` is the exact triggering sentence. `RankedTrial.languageWarning` => show the language warning badge.
- Criteria quotes: `card.inclusion` / `card.exclusion` are numbered `{ n, text }`; AI quotes reference `{ section, number }`.

## Local full-stack run
`npm run build && npm run preview` serves the static export and `/api/*` together via `wrangler dev` (local D1 seeded from data/build/criteria.sql). `next dev` alone has no API: `requestAnalysis` then returns a degraded response.

## Adaptive questionnaire (`lib/questionnaire/engine.ts`)
Pure functions over a `QuestionnaireState` (`lib/types/questionnaire.ts`, zod `QuestionnaireStateSchema`) and the catalog from `config/questionnaire` (`getCatalog("cancer", group)`, `FACT_POLICY`). Nothing here sends anything anywhere.
- State: `createState(mode = "quick")`, `setMode(state, "quick" | "thorough")`. Answers: `string` (single, ZIP, cancer type), `string[]` (multi), `number` (age; travel miles), `"anywhere"` (travel), `Record<BiomarkerId, "positive"|"negative"|"not_tested"|"unknown">` (biomarker grid), `null` (deferred).
- Non-response option ids: `UNKNOWN` ("unknown"), `SKIP` ("__skip"), `PREFER_NOT` ("prefer_not"), `DEFER`/`DEFERRED` ("deferred", "My doctor can fill this in later"). All four have identical matching semantics: no facts, no query terms, no hard filter, so the counter never drops.
- `applyAnswer(state, questionId, value, catalog, { gain?: step.utility }) => { state, dropped }`: records the answer (DEFER stores null + adds to `state.deferred`); editing an earlier answer keeps its history slot and drops dependents whose prerequisites (or catalog `maxAge`, e.g. pregnancy 59) no longer hold; it also drops/trims answers the passed catalog does not offer (options, biomarkers, questions), so when the cancer type changes pass `getCatalog("cancer", newGroup)` (`dropped` = ids to mention: "We removed N answers that no longer apply"). Pass the step's `utility` as `gain` so the Find-out list is ordered by usefulness.
- `goBack(state) => { state, question, previous }`: pops the last question and returns its previous answer to pre-fill; `nextQuestion` on the returned state asks that same question again (deterministic).
- `buildCandidatePool(state, { catalog, signal? }) => Promise<CandidatePool>`: call after `travel` (shards are already prefetched by `prefetchSearch` after cancer type). Hard filters (group, age, distance) + BM25 prior; no embeddings, milliseconds. Sex is applied live, so you never need to rebuild for it; you may rebuild after answers change to refresh the BM25 prior.
- Essentials count as answered when present; travel "anywhere" may be stored as `"anywhere"` or `null`.
- `nextQuestion(state, pool, catalog, { policy? }) => NextStep`:
  - `{ kind: "ask", question, utility, impact: { total, narrowedTo } }`. Essentials come first in fixed order (utility `Infinity`; pass an empty pool `{ group, trials: [] }` before the pool exists). Impact copy: "Answering this could narrow {total} trials to about {narrowedTo}" (hide when `narrowedTo === null`). `question.tier` drives the "Essentials · Helpful · Extra detail" header and the "Optional" label.
  - `{ kind: "done", reason: "small_set" | "low_gain" | "max_questions" | "exhausted" }` => show the summary card.
- `liveCount(state, pool, catalog, { policy? }) => { total, noConflict, supported }` => "**{total}** possible trials near you · **{noConflict}** with no likely conflicts" (aria-live polite, debounce 500 ms, announce on change only).
- `estimateRemaining(state, pool, catalog)` => "about N more questions"; `remainingOptional(state, pool, catalog)` => "Answer N more optional questions" after stopping (then `setMode(state, "thorough")`).
- `findOutList(state, catalog, getFindOutItems()) => FindOutEntry[]` (`{ question, whatKey, whereKey, whyKey, deferred }`), most useful first, for the summary, results and print view; `findOutQuestions(...)` = ids to reopen for "Fill in what you found out". "Prefer not to say" is not listed (a choice, not a gap).
- Session: `saveSession(state)` after each answer, `loadSession()` on mount (null if absent, invalid or older than 12 h), `clearSession()` for "Clear my answers". sessionStorage key `tb-questionnaire-v2` only.
- Search: `searchTrials(toIntakeAnswers(state, language), { catalog, policy: FACT_POLICY, onProgress, signal })` and `requestAnalysis(toIntakeAnswers(state, language), ...)`. With `questionnaire` + `catalog`, ranking uses the catalog-driven pre-check (`evaluateAnswers`), the definite-sex hard filter and the phase preference; without a catalog it falls back to the v1 pre-check.
- Results: `RankedTrial.scores.phaseBonus` (±0.03 or 0). When a definite sex answer hid trials, say "Studies for women only were hidden. Change".
- Privacy: `minimizeProfile` adds only coarse v2 fields (`v: 2`, subtype, stageCategory, diseaseStatus, priorLines, activityBand, brainMets, groupStatus, priorDrugClasses); HIV, hepatitis, transplant, autoimmune, organ problems, other cancer, sex, measurable disease, phase preference, ZIP, exact age, travel and the deferred/find-out lists never leave the browser. `findPrivacyLeaks(body, { zip, age, values })` (`lib/privacy/leaks.ts`) checks a request body for the e2e network test.
- Simulation helpers for eval (`lib/questionnaire/simulate.ts`): `samplePatient`, `simContext`, `runAdaptive`, `runFixed`, `ndcgAt10`.
