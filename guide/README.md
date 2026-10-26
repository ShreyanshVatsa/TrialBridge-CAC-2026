# TrialBridge: master guide

One page that says where everything is and how it runs. For the full product description, screenshots, and license notes, see the root [`README.md`](../README.md).

## 1. What TrialBridge is

TrialBridge helps people with cancer find recruiting clinical trials they might fit, explains each trial's rules in plain language, and keeps their private answers on their own device. It is for patients and the family members who search for them, especially people who live far from a major cancer center or who do not read English comfortably. It gives no medical advice: every result is a "possible match to discuss with your care team," quoted from the trial's own text. Trial data comes from ClinicalTrials.gov; TrialBridge is not affiliated with it or with any sponsor.

## 2. How to run it

Requires Node.js 22 or newer. The demo needs no API keys, accounts or paid services.

```
cd TrialBridge   # the unzipped or cloned project folder
npm ci
npm run demo
```

`npm run demo` (`scripts/local.ts --mode=demo --open`) downloads the embedding model once (about 23 MB), builds the committed seed dataset of 301 real trials if there is no data yet, builds the site, starts it at http://localhost:8790 with the built-in mock AI provider (the recorded real-AI answers for the sample patient are for national trials outside the seed, so on a fresh clone the explanations come from the mock provider; they replay after `npm run ingest` for trials whose text is unchanged), runs a PASS/FAIL self-check and opens the browser. On macOS you can double-click `Start TrialBridge Demo.command` instead. The full app with real AI (`npm run local`, a key in `.dev.vars`; see `.dev.vars.example`) runs at http://localhost:8787. Ctrl+C stops it.

- One-click sample patient: http://localhost:8790/find/?demo=1 (a clearly labelled, made-up patient; goes straight to results).
- All national trials (about 5,700): `npm run local:national`.
- Real AI providers are optional. Keys go in `.dev.vars`, a local file that holds private keys. It is listed in `.gitignore` and is never committed; do not paste its contents anywhere. A provider is used only if its key is set and `dataTermsVerified` is true in `config/ai-providers.ts`; without that, the deterministic mock provider runs and AI explanations are placeholders.

| Task | Command |
| --- | --- |
| UI only, hot reload (no API) | `npm run dev` |
| Full local build and preview (site + Worker + local D1) | `npm run build` then `npm run preview` |
| Lint, types, unit tests with coverage | `npm run lint`, `npm run typecheck`, `npm test` (`npm run test:unit` skips coverage) |
| End-to-end and accessibility tests (after a build; first time `npx playwright install chromium`) | `npm run test:e2e` |
| Performance budgets (after a build) | `npm run budgets` |
| Data integrity check | `npm run data:verify` |
| Everything CI runs | `npm run ci` |
| Evaluation | `npm run eval`, `npm run eval:matching`, `npm run eval:vignettes`, `npm run eval:split` |
| Seed data / national data | `npm run ingest:seed`, `npm run ingest` |

## 3. Architecture

The site is a static Next.js export (`next.config.ts`, output in `out/`). A small Cloudflare Worker (`functions/index.ts`, configured in `wrangler.jsonc`) serves it and exposes three API routes, with a D1 database for cache, rate limits and budgets (`functions/migrations/0001_init.sql`). Matching itself runs in the browser.

```
 BROWSER (static export from app/, components/)
 +--------------------------------------------------------------+
 | questionnaire -> hard filters -> BM25 + MiniLM embeddings    |
 |   (answers stay    (lib/match/rank.ts)   fused (RRF)         |
 |    in this tab)                              |               |
 |                                  deterministic resolver      |
 |                                  (lib/match/resolve/)        |
 |                                              |               |
 |                              tiers + checklist in the UI     |
 +----------------------------+---------------------------------+
                              | only for AI steps: coarse profile
                              | (lib/privacy/minimize.ts)
                              v
 CLOUDFLARE WORKER (functions/): /api/match, /api/analyze, /api/ask
 +--------------------------------------------------------------+
 | same-origin + 16 KB limit + Turnstile + D1 rate limits       |
 | + budgets -> provider failover -> schema check -> quote check|
 +----------------------------+---------------------------------+
                              v
        OpenAI-compatible provider, or the built-in mock
```

Trial data, ZIP tables and the embedding model are static files under `public/` (`public/data`, `public/models`, `public/ort`), loaded by `lib/data/loader.ts`. The service worker `public/sw.js` makes the site installable and caches the app shell (pages, scripts, fonts, icons); trial data, models and AI calls always come from the network, so searching needs a connection.

## 4. The search pipeline, step by step

The browser entry point is `lib/match/search.ts` (loads data shards, the ZIP centroid and the profile embedding, then calls the pure ranking function). The UI side is `components/find/find-flow.tsx`.

1. **Questionnaire.** Four essentials, then adaptive questions. Catalog: `config/questionnaire/` (`common.ts` for cross-cancer questions, `cancer/<group>.ts` per cancer group). Engine: `lib/questionnaire/engine.ts`; UI: `components/questionnaire/`. Answers are compiled to rules by `lib/questionnaire/rules.ts`.
2. **Hard filters.** In `lib/match/rank.ts` (`rankTrials`) using `lib/match/filters.ts`: cancer group, age, stated sex, and distance to the nearest trial site (`lib/geo/distance.ts`).
3. **BM25 and embeddings.** BM25 keyword ranking via MiniSearch (`lib/match/keyword.ts`, `lib/match/minisearch-config.ts`); the query text is built in `lib/match/query.ts`. The profile is embedded with MiniLM in a Web Worker (`lib/match/embedder.ts`, `lib/match/embed.worker.ts`) and compared by cosine similarity (`lib/match/cosine.ts`) with the trial vectors.
4. **Fusion.** The two rankings are combined with Reciprocal Rank Fusion (`lib/match/rrf.ts`), then a final score is computed from named features and weights: `lib/match/fusion.ts`, weights in `lib/match/fusion-weights.json`.
5. **Precheck.** Each trial's extracted rule facts are compared with the answers (`lib/match/precheck.ts`), plus sibling-disease subtype tags (`lib/match/subtype.ts`) and extent of disease (`lib/match/extent.ts`). These adjust the score as penalties or bonuses. A fact may lower a trial only if its measured precision passes the gate in `config/questionnaire/fact-policy.ts` (see `docs/dev/FACTS.md`); "unknown" never lowers a trial.
6. **`rankTrials` and `TOP_N`.** `rankTrials` in `lib/match/rank.ts` sorts by the fused score and keeps `TOP_N` results (20).
7. **Deterministic criteria resolver.** `lib/match/resolve/` (`index.ts`, with `demographics.ts`, `facts.ts`, `markers.ts`, `profile.ts`, `stage.ts`, `text.ts`, `treated.ts`) labels each split requirement of each trial as met, not met, excluded or unknown, from the patient's answers. Orchestration is in `lib/match/criteria-rank.ts` and `lib/match/criteria-resolve.ts`. Criteria are split at ingest time by `lib/ingest/criteria-split.ts`.
8. **Tiers.** `lib/match/score.ts` turns the labels into a per-trial score. Tier B means a requirement may rule the person out (any inclusion not met or exclusion hit); otherwise Tier A. Unknowns never change the tier. `tierOrder` puts Tier A first. The UI shows Tier B under its own heading (`components/results/results-view.tsx`, `components/results/match-checklist.tsx`).
9. **LLM judge on the top few.** Only the requirements the resolver left unknown, for the top `topN` trials (5), go to the judge (`config/match-judge.ts`, client in `lib/api/match.ts`, server in `functions/lib/match.ts`, prompt in `prompts/analyze-v3.ts`). The judge must quote the trial text verbatim; `functions/lib/quotes.ts` discards quotes that do not match. Without keys, the mock provider answers and the ranking comes from retrieval and rules alone.

## 5. Directory map

| Folder / file | What it holds |
| --- | --- |
| `app/` | Next.js routes: `find`, `trial`, `access`, `about`, `methodology`, `for-sites`, `privacy`, `privacy-policy`, `terms`, `offline`; layout, manifest, global CSS |
| `components/` | UI, grouped by feature (below) |
| `lib/` | Matching, privacy, safety, data loading, ingestion logic, types (below) |
| `functions/` | Cloudflare Worker: `index.ts` routing, `lib/` handlers (analyze, ask, match, budget, rate limit, quotes, safety, Turnstile, AI providers in `lib/ai/`), `migrations/` D1 schema |
| `config/` | Cancer groups, biomarkers, criteria rules, locales, AI providers, retrieval and judge settings, `questionnaire/` catalog and fact policy |
| `prompts/` | Versioned prompts for the AI steps and fact extraction |
| `scripts/` | Local runner (`local.ts`), ingestion (`ingest/`), evaluation (`eval/`), translation (`i18n/`), budgets, data verification, build helpers |
| `data/` | `seed/studies.json` (committed seed trials), `data-lock.json` (pinned snapshot hashes), `geo/` ZIP source, `build/` generated criteria and D1 SQL, `cache/` local caches |
| `public/` | Static assets served as-is: built `data/` shards, `models/`, `ort/`, `i18n/` translations, fonts, icons, `sw.js`, `_headers` (CSP and other headers) |
| `i18n/` | Translation glossaries (`glossary/`) and state (`state/`) used by the translate script |
| `eval/` | Evaluation reports, gold labels, benchmarks (see `eval/README.md`) |
| `tests/` | `unit/` (Vitest) and `e2e/` (Playwright, including axe accessibility checks) |
| `perf/` | `budgets.json`, the size budgets checked by `npm run budgets` |
| `docs/` | `dev/` maintainer notes, `screenshots/` for the README |
| `content/` | Long-form page text (`founder-story.ts`) |
| `vendor/` | Vendored build-time packages (`fast-glob`, `shadcn-css`) |
| `.github/workflows/` | `ci.yml` and `refresh.yml` (data refresh, run by hand) |
| `wrangler.jsonc`, `next.config.ts`, `playwright.config.ts`, `vitest.config.ts` | Tool configuration |
| `out/`, `test-results/` | Build and test output (generated) |

**`lib/` subfolders**

| Folder | Purpose |
| --- | --- |
| `lib/match/` | The search pipeline (section 4) |
| `lib/questionnaire/` | Question engine, rule compilation, candidate pool, simulation |
| `lib/ingest/` | Parsing registry records, criteria splitting, fact extraction, cancer-group mapping, barrier flags, snapshots |
| `lib/privacy/` | `minimize.ts`, `scrub.ts`, `leaks.ts` |
| `lib/safety/` | Crisis detection and per-language lexicons |
| `lib/api/` | Browser clients for `/api/match`, `/api/analyze`, `/api/ask`, Turnstile |
| `lib/data/`, `lib/geo/` | Data shard loader and ZIP lookup; distance math |
| `lib/access/` | Access Intelligence aggregation |
| `lib/i18n/` | Translation keys, manifest, AI response language |
| `lib/types/` | zod schemas and types shared by browser and Worker |
| `lib/perf/` | Search timing counters |

**`components/` subfolders**

| Folder | Purpose |
| --- | --- |
| `components/find/`, `components/questionnaire/` | The find flow and questionnaire UI (includes the sample patient) |
| `components/results/` | Result cards, requirement checklist, status badges |
| `components/trial/` | Trial detail and the Q&A panel |
| `components/access/` | Access Intelligence page and US tile map |
| `components/site/` | Header, footer, disclaimer, language switcher, skip link, theme toggle |
| `components/i18n/` | Language picker, translation note, crisis line |
| `components/landing/`, `components/pages/`, `components/fx/` | Landing page, static content pages, motion effects |
| `components/session/`, `components/chat/`, `components/ui/` | Session state provider, chat primitives, button primitive |

## 6. Data

- **Source.** ClinicalTrials.gov API v2. ZIP centroids come from the U.S. Census gazetteer (`data/geo/zcta.csv`). TREC topics are used for evaluation only (`eval/trec/TERMS.md`).
- **Seed.** `data/seed/studies.json` is committed (301 trials). `npm run ingest:seed` builds from it; `npm run setup` fetches the model and builds the seed.
- **National.** `npm run ingest` (`scripts/ingest/index.ts`, `scripts/ingest/ctgov.ts`) fetches, validates, maps conditions to cancer groups, splits criteria, extracts rule facts and barrier flags, computes int8 embeddings, and writes versioned shards, `access.json` and ZIP tables to `public/data/`, plus a D1 copy (`data/build/criteria.sql`, loaded with `npm run db:seed:local`).
- **Pinning and verification.** `data/data-lock.json` records the snapshot. `npm run data:verify` (`scripts/data-verify.ts`) checks model file hashes, snapshot hashes, and that `public/data` and the D1 seed carry the same data version. `scripts/ensure-data.ts` runs before every build so a build always has a model and seed data.
- **Refresh.** `.github/workflows/refresh.yml` is run by hand (workflow_dispatch); it rebuilds, verifies, and opens a pull request that updates the lock.
- **Optional LLM extraction.** `npm run ingest:llm` (`scripts/ingest/llm.ts`, prompt `prompts/ingest-facts-v2.ts`).
- Model weights: `npm run models:fetch` (`scripts/fetch-models.ts`, hash-pinned); fonts: `npm run fonts:fetch`.

## 7. Testing and evaluation

- **Unit tests.** Vitest, in `tests/unit/` (and a few `*.test.ts` beside scripts). `npm test` runs them with coverage. The root README reports 1,332 unit tests.
- **End-to-end and accessibility.** Playwright specs in `tests/e2e/` (`a11y.spec.ts` uses axe; also questionnaire, match, Q&A, i18n, offline/perf, and a network test that checks no raw questionnaire field leaves the browser). The root README reports 86 end-to-end and accessibility tests. `npm run test:e2e` copies the build, applies local D1 migrations and seed, then runs Playwright.
- **Budgets.** `perf/budgets.json` and `scripts/budgets.ts` hold route JavaScript, data shard downloads and the cold-search download to fixed sizes.
- **Evaluation harnesses.** Start with [`eval/README.md`](../eval/README.md), which lists every file and the script that produces it. Results with confidence intervals are in [`eval/RESULTS.md`](../eval/RESULTS.md); the regression report is `eval/REGRESSION.md`. Harness code is in `scripts/eval/` (vignettes, TREC matching, criteria splitter check, hard-filter oracle).
- **Headline results (copied from the root README).** Vignette benchmark, held-out test split (v9 vs v8, run once): share of the top 10 that the gold says rule the patient out 45.5% to 38.6%; nDCG@10 not distinguishable (0.285 vs 0.296). Hard filters vs an independent oracle on national data: 0 violations in 800 top-20 results. TREC held-out topics, full pipeline vs retrieval baseline (v7, frozen): nDCG@10 +0.069 [0.015, 0.120]. Nothing here is a clinical-accuracy claim.
- **Rule-fact precision.** `docs/dev/FACTS.md` states how precise each extracted rule fact is and what matching may do with it.

## 8. Privacy, safety and accessibility

Each point below is implemented in the code named.

- **Matching stays on the device.** Ranking runs in the browser (`lib/match/`). ZIP code, exact age and travel distance are not sent.
- **Minimized profile.** Anything that reaches the Worker goes through `lib/privacy/minimize.ts` (cancer type, age bracket, coarse categories, biomarkers, language). `lib/privacy/leaks.ts` lists keys that must never appear in a request; unit tests (`tests/unit/minimize.test.ts`, `tests/unit/qn-privacy.test.ts`) and the e2e network test check it.
- **Scrubbing free text.** `lib/privacy/scrub.ts` removes emails, phone numbers, SSNs, dates, names, addresses, ZIP codes and similar from questions before and after they leave the browser.
- **Crisis and refusal rules before any model.** `lib/safety/crisis.ts` with lexicons in `lib/safety/lexicons/`; server side `functions/lib/safety.ts`; the crisis line component is `components/i18n/crisis-line.tsx`.
- **Verified quotes.** `functions/lib/quotes.ts` discards AI quotes that do not appear in the trial text.
- **Disclaimer.** `components/site/disclaimer.tsx`, shown with results and trial pages.
- **Worker protections.** Same-origin check, 16 KB body limit, Turnstile, per-IP rate limits and daily budgets in D1 (`functions/lib/ratelimit.ts`, `budget.ts`, `turnstile.ts`, `http.ts`); headers in `public/_headers`; build-time secret scan in `scripts/postbuild.ts`. Details and reporting contact: [`SECURITY.md`](../SECURITY.md).
- **Languages.** Locale tags are registered in `config/locales.ts`; translations are in `public/i18n/`. They are machine-translated; official trial text stays in English.
- **Accessibility.** Skip link (`components/site/skip-link.tsx`), theme toggle, self-hosted Atkinson Hyperlegible Next font (`app/fonts.ts`), and automated axe checks in `tests/e2e/a11y.spec.ts`.

## 9. Where to look for...

| I want to... | Go to |
| --- | --- |
| Change or add a question | `config/questionnaire/common.ts` or `config/questionnaire/cancer/<group>.ts`; builders in `config/questionnaire/build.ts`; spec in `docs/dev/QUESTIONNAIRE_SPEC.md` |
| Change which questions are asked next | `lib/questionnaire/engine.ts`, `lib/questionnaire/pool.ts` |
| Change a hard filter | `lib/match/filters.ts`, called from `lib/match/rank.ts` |
| Change ranking weights | `lib/match/fusion-weights.json` (features in `lib/match/fusion.ts`; refit script `scripts/eval/fusion-fit.ts`) |
| Change how many results are re-ranked | `TOP_N` in `lib/match/rank.ts` |
| Change how a requirement is judged met or not met | `lib/match/resolve/` |
| Change which facts may lower a trial | `config/questionnaire/fact-policy.ts` (precision tables are generated; see `docs/dev/FACTS.md`) |
| Change how many trials the AI judge reads | `topN` in `config/match-judge.ts` |
| Change a prompt | `prompts/` |
| Add or change an AI provider | `config/ai-providers.ts`, `functions/lib/ai/` |
| Add a language | one entry in `config/locales.ts`, then `npm run i18n:translate -- <tag>`; glossary in `i18n/glossary/`; optional crisis lexicon in `lib/safety/lexicons/` (see the comment at the top of `config/locales.ts`) |
| Change English UI text | `components/i18n/en.ts`, then `npm run i18n:manifest` |
| Edit the disclaimer | `components/site/disclaimer.tsx` |
| Change a page | `app/<route>/page.tsx` and `components/pages/` |
| Change security headers | `public/_headers` |
| Change a size budget | `perf/budgets.json` |
| Change cancer groups or biomarkers | `config/cancer-groups.ts`, `config/biomarkers.ts` |
| Change the barrier flags (English-required, age cap, and so on) | `config/barriers.ts`, `lib/ingest/barriers.ts` |
| Rebuild the dataset | `npm run ingest:seed` or `npm run ingest` |
| Add an API route | `functions/index.ts`, `functions/lib/` |

## 10. Deeper documents

- [`README.md`](../README.md): product overview, features, library licenses
- [`SECURITY.md`](../SECURITY.md): protections and reporting
- [`docs/dev/README.md`](../docs/dev/README.md): index of maintainer notes
- [`docs/dev/API.md`](../docs/dev/API.md): contract between the UI and `lib/`
- [`docs/dev/QUESTIONNAIRE_SPEC.md`](../docs/dev/QUESTIONNAIRE_SPEC.md): questionnaire, fact families, i18n platform
- [`docs/dev/FACTS.md`](../docs/dev/FACTS.md): precision of each rule fact
- [`docs/dev/SECURITY_AUDIT.md`](../docs/dev/SECURITY_AUDIT.md): internal security review
- [`docs/dev/ai-in-product.md`](../docs/dev/ai-in-product.md): how AI providers are used and what they receive
- [`docs/dev/design-system.md`](../docs/dev/design-system.md): visual system
- [`eval/README.md`](../eval/README.md), [`eval/RESULTS.md`](../eval/RESULTS.md), [`eval/REGRESSION.md`](../eval/REGRESSION.md), [`eval/matching/RESULTS.md`](../eval/matching/RESULTS.md), [`eval/trec/README.md`](../eval/trec/README.md)
