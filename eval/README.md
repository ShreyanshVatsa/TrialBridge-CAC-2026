# eval/: what each file is and what produces it

Every number in `eval/RESULTS.md` comes from one of the files below. "Live" files are read or rewritten by a current
script; "historical" files are frozen inputs kept so older results stay reproducible. Nothing here is real patient data:
patients are synthetic profiles or the public TREC topics, and labels are rule-derived, human TREC qrels or independent labeling passes
(non-clinician labelers), as each row says.

## Reports

| file | what | produced by | status |
| --- | --- | --- | --- |
| `RESULTS.md` | the evaluation report, every version's numbers with their source | summarized from the runs below | live |
| `REGRESSION.md` | retrieval, hard-filter safety, fact precision, mock AI checks | `npm run eval` (`scripts/eval/run.ts`) | live |
| `results.json` | machine-readable form of `REGRESSION.md` | `npm run eval` | live |
| `rrf-k.md` | rank-fusion constant sweep | `npm run eval` | live |

## Benchmarks

| path | what | producer / reader | status |
| --- | --- | --- | --- |
| `gold/vignettes-v1.json` | 164 synthetic patients (94 dev, 70 test) with questionnaire answers and free text | authored; `scripts/eval/vignettes/validate.ts` checks it | frozen |
| `gold/vignettes-pool-v1.json` | top-50 rankings per system per vignette (bm25, vector, ctgov, pipeline by tag) | `vignettes/pool.ts`, `vignettes/add-pipeline.ts --tag=...` | live (append only) |
| `gold/vignettes-gold-v1.json` | labels per pooled pair, second-pass labels, contested flags | `vignettes/build-gold.ts` from `gold/judgments/` | frozen |
| `gold/judgments/` | raw labeling-pass files (judge-a, judge-b), quote-verified | labeling passes, checked by `vignettes/judge-check.ts` | frozen |
| `trec/` | TREC CT 2021/2022 cancer topics with structured answers | `scripts/eval/trec/select-topics.ts`; see `trec/README.md` | frozen |
| `matching/dev.json`, `matching/test.json` | TREC matching arms (baseline, resolver, +LLM) per topic | `npm run eval:matching` | dev live; test frozen |
| `matching/test-runs*.json` | log of every held-out run (v7: one run) | `npm run eval:matching -- --split=test` | frozen |
| `trialgpt/` | criterion-splitter check against TrialGPT's pre-split criteria | `npm run eval:split` | live |

## Rule-layer labels

| file | what | producer / reader | status |
| --- | --- | --- | --- |
| `labels.json` | 30 synthetic profiles with title/condition relevance rules (seed trials) | `scripts/eval/make-labels.ts`; read by `run.ts`, `bench.ts`, `tune-retrieval.ts` | live |
| `assertions.json` | short criterion sentences with the facts a reader expects | authored; `scripts/eval/assertions.ts` | live |
| `facts-labels.json` | post-hoc review of extractor output on seed trials | item-by-item review; `scripts/ingest/v1-precision.ts`, `run.ts` | live |
| `facts-labels-v2.json` | fact labels for the LLM fact-extraction comparison | `scripts/ingest/fact-precision.ts`, `llm-eval.ts` | historical |
| `facts-labels-v3.json` | held-out fact labels behind the per-fact precision gate | `scripts/ingest/v1-precision.ts`; read by `lib/ingest/facts.ts` | live |
| `llm-dev-labels.json`, `llm-gold-results.json` | LLM fact-extraction dev labels and scores | `scripts/ingest/llm-eval.ts` | historical |
| `gold/gold-v1.json`, `gold/gold-v2.json`, `gold/gold-v3-sample.json` | criterion-level fact gold sets | `scripts/ingest/llm-eval.ts`, `gold-v3.ts`; see `gold/README.md` | historical |
| `review/translations-*.md` | per-locale translation review packets | `npm run i18n:review-packet` | live |

## Scripts in `scripts/eval/`

- `run.ts` (`npm run eval`): regression report. Uses `oracle.ts` (independent hard-filter oracle), `headline.ts`
  (national-scale section), `assertions.ts`, `stats.ts`, `national.ts` (shard loader), `common.ts`.
- `vignettes/`: the vignette benchmark. `live.ts` scores the current code (the one to run while changing matching),
  `run.ts` scores stored systems, `diagnose.ts` is the one-command headroom diagnostic, `error-analysis.ts` lists why
  excluded trials rank high; the rest build the pool and gold.
- `matching/run.ts` (`npm run eval:matching`): TREC matching with and without the LLM judge; `replay-cache.ts` and
  `live-check.ts` test the judge path.
- `trec/`, `trialgpt/`: benchmark loaders and the splitter check.
- Tools kept for re-running past experiments: `tune-retrieval.ts`, `fusion-fit.ts`, `vignettes/fit-weights.ts` (weight
  sweeps, reverted as not significant), `resolve-share.ts` (how many items the resolver settles), `simulate.ts`
  (adaptive vs fixed questionnaire), `bench.ts` (hot-path timings), `fingerprint.ts` (proves a refactor changed nothing),
  `embed.ts` (embedding helper).

Rules: decisions use dev splits only. The TREC test split and the vignette test split are run once per version, after
the last code change, and every run is logged.
