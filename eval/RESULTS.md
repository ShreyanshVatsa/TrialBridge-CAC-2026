# Evaluation results: v9

Summary of results (the v8 and v7 sections below are kept for comparison). Every number was measured by a script in this repo; nothing is imputed. Nothing here is a clinical-accuracy claim: TREC labels are human relevance judgements for a research benchmark, the other labels are synthetic or rule-derived.

Detailed, generated reports:
- `eval/matching/RESULTS.md` (+ `dev.json`, `test.json`, `test-runs-v7.json`): TREC criterion-matching eval, `npm run eval:matching`.
- `eval/REGRESSION.md` (+ `results.json`): regression eval with random/BM25 baselines and the hard-filter oracle, `npm run eval`.
- `eval/facts-labels-v3.json`: held-out precision of the v1 rule facts (v7).

Intervals are bootstrap 95% CIs over topics (TREC) or profiles (regression). "Distinguishable" means the paired-difference CI excludes 0.


## v9 (2026-10-23): wrong-disease and wrong-stage demotion, resolver pool 20

Changes (decided on dev only): sibling-disease subtype tags read from the trial's own title and conditions (non-Hodgkin for a Hodgkin patient, brain metastases for a primary brain tumor, melanoma for other skin cancers, soft-tissue for bone sarcoma, colorectal for anal cancer), subtype conflict weight -0.18 -> -0.35, and a case bug that kept "Follicular Lymphoma" from ever matching; a soft penalty (-0.6) when the trial's own title names only an extent the patient's definite `spread` answer contradicts (early-stage-only trials for spread far, metastatic-only trials for not spread or removed); receptor pairs and HER2 score ranges are one attribute, not options; the resolver re-ranks the top 20 instead of 15. Tried and reverted: cohort-level treated status (each cohort is its own split item, so failing one wrongly failed the trial; Tier B precision fell to 0.946). Not done: new questionnaire questions and re-pooling. The code was frozen before the test run.

| what (pipeline + resolver) | v8 | v9 |
| --- | --- | --- |
| Vignette dev excluded share in top 10 | 0.516 | 0.431 (paired -0.086 [-0.114, -0.058]) |
| Vignette dev nDCG@10, all 94 / 71 with a relevant trial | 0.368 / 0.487 | 0.366 [0.299, 0.432] / 0.484 [0.417, 0.551] (paired -0.002 [-0.024, 0.022]) |
| Vignette dev condensed nDCG@10 (unjudged dropped), all / relevant-only | 0.377 / 0.500 | 0.420 / 0.556 |
| Vignette dev unjudged share of top 10 | 0.057 | 0.167 |
| Vignette dev wrong-population (gold not relevant) top-10 slots | 133 of 816 (16%) | about 106 after M1 alone (13%) |
| Vignette dev Tier B demotion precision | 0.968 | 0.959 (1 gold-eligible, 12 possibly of 314 judged) |
| Vignette test excluded share in top 10, run once | 0.455 | **0.386 (paired -0.069 [-0.104, -0.035])** |
| Vignette test nDCG@10, all 70 / 57 with a relevant trial, run once | 0.296 / 0.364 | 0.285 [0.230, 0.341] / 0.351 [0.295, 0.406] (paired -0.010 [-0.037, 0.019]) |
| Vignette test condensed nDCG@10 / unjudged share of top 10 | n/a | 0.333 / 0.157 |
| Vignette test Tier B demotion precision | n/a | 0.899 (2 gold-eligible, 18 possibly of 199 judged) |
| TREC dev nDCG@10: baseline / resolver / resolver+LLM | 0.521 / 0.545 / 0.562 | 0.521 / 0.561 [0.433, 0.694] / 0.569 [0.451, 0.689] |
| TREC dev missed exclusions, resolver+LLM; judge Tier B precision | 0.240; 80% (4/5) | 0.240; 100% (4/4) |
| TREC held-out (frozen since v7, not re-run) | 0.819 with the judge | not run |
| Regression: national pipeline nDCG@10 / hard-filter oracle | 0.780 / 0 of 600 (top 15) | 0.804 [0.719, 0.876] / 0 of 800 (top 20) |

Reading: v9 is a safety release, not an nDCG release. The share of the top 10 that the gold says rules the patient out falls on both vignette splits, and the drop replicates on the held-out test split (-0.069, CI excludes 0). Graded nDCG@10 does not move on either split. Part of that is measurement: the v9 lists surface trials the v1 pool never judged (unjudged share of the top 10 rose from about 6% to 16%), and the benchmark scores those as not relevant; with them dropped (condensed) dev rises 0.377 -> 0.420. We did not re-judge them, so the condensed number is an upper-bound check, not a claim. Tier B demotion precision held on dev (0.959) but is 0.899 on test: the deeper pool (20) demotes more trials, and on test 20 of 199 judged demotions were trials the gold calls eligible or possibly. TREC dev moves +0.016 (resolver) and +0.007 (with the judge), within its wide CI over 10 topics. The judge calls in that run were all served from the response cache (no new Groq tokens).

## 0a. How to read the vignette numbers (v9 metric framing, measured on the v8 code, vignette dev)

`npx tsx scripts/eval/vignettes/live.ts --split=dev` prints every row below with a bootstrap 95% CI; `npx tsx scripts/eval/vignettes/diagnose.ts` prints the oracle rows and the waterfall. The all-vignette mean scores a vignette with no relevant judged trial as 0, so it cannot exceed the share of vignettes that have one (71 of 94 on dev, 0.755; 57 of 70 on test). From v9 the headline is graded nDCG@10 over the vignettes with a relevant trial (the TREC convention), always printed next to the all-vignette mean. Recall below is the micro share of all relevant trials; live.ts also prints the per-vignette mean.

| metric (vignette dev, v8 code) | value | ceiling / note |
| --- | --- | --- |
| graded nDCG@10, all 94 (v8 headline) | 0.368 [0.306, 0.431] | ceiling 0.755 |
| graded nDCG@10, 71 with a relevant trial (v9 headline) | 0.487 [0.424, 0.550] | ceiling 1.0 |
| binary nDCG@10 (eligible + possibly = 1), all / relevant-only | 0.381 / 0.504 | |
| eligible-only binary nDCG@10 (41 vignettes with an eligible trial) | 0.333 | 53 of 94 have none |
| retrieval order only (no resolver), all / relevant-only | 0.304 / 0.402 | |
| oracle: perfect order of the top 15 / top 50, all / relevant-only | 0.513 / 0.679, 0.678 / 0.898 | what the best possible re-ranker of these lists could score |
| P@10 relevant (divided by 10, relevant-only vignettes) | 0.303 | mean achievable 0.637 (median 4 relevant per vignette) |
| hit@10 / hit@50 (vignettes with a relevant trial) | 0.915 / 1.000 | |
| recall of relevant trials @10 / @15 / @30 / @50 | 36% / 45% / 71% / 81% | 597 relevant trials; all 597 pass the hard filters |
| top-10 slot composition (816 slots) | relevant 26%, excluded 51%, not relevant 16%, unjudged 6% | |
| condensed nDCG@10 (unjudged trials dropped), all / relevant-only | 0.377 / 0.500 | pooling-bias check: +0.009 today |
| Tier B demotion precision (gold excluded or not relevant, of judged Tier B trials in the re-ranked top 15) | 0.968 (272 of 281; 0 gold-eligible, 9 possibly) | the "does not wrongly rule out" metric |

Waterfall (cumulative oracles on the live top 50, nDCG@10 over all 94): current 0.368; remove trials the resolver already fails but still shows +0.004; trials the resolver could settle from the answers +0.037; trials whose criterion is about an asked topic but no fact was extracted +0.072; trials excluded on detail no question asks +0.037; gold not-relevant trials (wrong population or purpose) +0.045; dropping the unjudged trials that fill the freed slots +0.093 (a pooling-bias bound, not a gain); perfect order of the rest +0.022, total 0.678. Read: about 0.11 of the gap is resolver and extractor engineering on the existing questionnaire, 0.04 needs new questions, 0.045 is trial purpose and population. nDCG@10 in the 0.9s is not reachable with this gold, questionnaire and judge; the safety and coverage numbers (Tier B precision, hit@50, hard-filter loss 0) are the ones that are in the 90s, and they measure "does not wrongly rule out", not matching accuracy.

## 0. v8 (2026-10-22): resolver coverage, query construction, judge output shrink

Changes: the deterministic resolver reads the extent of disease from the `spread` answer, treated status and line counts from the item's own wording, alternatives option by option, negated marker lists, plain subtype and hepatitis items, and ignores definitions, assessment windows and registration headers; the BM25/embedding query names positive biomarkers only; the judge prompt (analyze-v3.2) returns a reason and answer ids only for definite labels. Every decision was made on TREC 2021 dev and vignette dev; the vignette test split ran once at the end; the TREC test split was not run (frozen since v7).

| what | v7 | v8 |
| --- | --- | --- |
| TREC dev nDCG@10: baseline / resolver / resolver+LLM | 0.491 / 0.521 / 0.550 | 0.521 [0.376, 0.652] / 0.545 [0.432, 0.665] / 0.562 [0.449, 0.681] |
| TREC dev missed exclusions: baseline / resolver / resolver+LLM | 0.330 / 0.280 / 0.270 | 0.340 / 0.280 / 0.240 [0.150, 0.330] |
| TREC dev paired resolver+LLM - baseline nDCG@10 | +0.060 [0.002, 0.120] | +0.041 [-0.007, 0.098] (the baseline itself moved up 0.030 with the query change) |
| TREC dev judge: tokens per patient / coverage / model latency | 7,388 / 92.0% / 6.2 s | 6,527 [5,389, 7,761] / 98.9% / 6.0 s |
| Vignette dev nDCG@10, pipeline+resolver (vs pipeline:v4) | 0.325 [0.267, 0.386] (+0.038 [0.003, 0.072]) | 0.368 [0.306, 0.431] (+0.080 [0.043, 0.118]); vs v7+resolver +0.043 [0.021, 0.064] |
| Vignette dev excluded share in top 10 | 0.545 | 0.516 [0.461, 0.575] |
| Vignette test nDCG@10, pipeline+resolver (vs pipeline:v4), run once | 0.295 [0.237, 0.352] (-0.012 [-0.051, 0.027]) | 0.296 [0.236, 0.354] (-0.011 [-0.053, 0.028]); retrieval only 0.320 [0.257, 0.384] (+0.014 [-0.019, 0.046]) |
| Vignette test excluded share in top 10 | 0.487 | 0.455 [0.391, 0.519] |
| Items the resolver settles, every question answered (1,000 trials) | 6.1% | 7.1% |
| Regression eval: national pipeline nDCG@10 / oracle top 15 | 0.779 / 0 of 600 | 0.780 [0.691, 0.858] / 0 of 600 |

Honest reading: the dev gains are distinguishable (vignette dev +0.043 over v7, with Tier B demotion precision of 63/2 for stage, 32/2 for treated status, 99/1 for ECOG against the gold), the TREC dev judge arm is at its best value so far at 11% fewer tokens, but on the vignette test split the resolver re-ranking still does not add nDCG over the retrieval order (0.296 vs 0.320), exactly as in v7; it lowers the excluded share (0.455, the lowest of any system) and the retrieval order itself is the best on test. The test gold is LLM-judged and pooled before v8 (94.5% of the v8 top 10 judged), so a ranking that surfaces unpooled trials is under-credited.

Efficiency (local Chromium, `npx tsx scripts/perf/search-timings.ts`): first results 1.2 s cold / 0.37 s warm on localhost, 4.8 s cold at 20 Mbps; cold download about 23.5 MB compressed (model 15.7 MB, ORT wasm 3.6 MB, breast shards 3.6 MB, app 0.7 MB); main-thread long task 75-112 ms. The embedding model is already the smallest published variant; shard restructuring (-0.9 MB per group) and pool-size changes were measured and not adopted.

## 1. Matching on TREC Clinical Trials (cancer topics, human qrels)

Arms: **baseline** = v5 pipeline order; **resolver** = deterministic per-criterion labels re-ranking the top 15 (Tier A first); **resolver+LLM** = resolver plus the Groq judge (gpt-oss-120b) on the unknown items of the top 5 (`MATCH_JUDGE.topN`; screening-only items not sent). The eval measures the judge without the 45 s production deadline (see section 3 for production).

### Held-out test: TREC 2022 (2 topics) + TREC 2023 breast-cancer templates (5 topics), run once

Frozen before any v7 tuning was measured; never used for a decision. 2023 templates give no age or sex (age 50, female assumed).

| metric | baseline | resolver | resolver+LLM |
| --- | --- | --- | --- |
| nDCG@10 | 0.749 [0.648, 0.845] | 0.805 [0.710, 0.895] | 0.819 [0.723, 0.912] |
| P@10 (eligible) | 0.571 [0.357, 0.771] | 0.614 [0.429, 0.800] | 0.629 [0.429, 0.829] |
| missed exclusions (TREC-excluded in Tier A of top 10) | 0.400 [0.186, 0.629] | 0.329 [0.171, 0.486] | 0.229 [0.086, 0.357] |

Paired vs baseline: resolver+LLM nDCG@10 **+0.069 [0.015, 0.120]**, P@10 **+0.057 [0.028, 0.086]**, missed exclusions **-0.171 [-0.286, -0.071]**; resolver alone nDCG@10 +0.056 [0.012, 0.107], missed exclusions -0.071 [-0.157, -0.014]. All distinguishable (better). Judge Tier B demotions in the top 10: 7, all TREC-excluded (7/7). JSON validity 10/10, coverage 99.2%, 6.0k tokens per patient.

v6 had no successful held-out judge result (both TREC 2022 topics degraded on malformed output).

### Dev: TREC 2021 (10 topics; v7 decisions were made here)

| metric | baseline | resolver | resolver+LLM |
| --- | --- | --- | --- |
| nDCG@10 | 0.491 [0.348, 0.630] | 0.521 [0.415, 0.641] | 0.550 [0.444, 0.665] |
| P@10 | 0.330 [0.210, 0.460] | 0.360 [0.250, 0.490] | 0.360 [0.240, 0.490] |
| missed exclusions | 0.330 [0.190, 0.490] | 0.280 [0.170, 0.400] | 0.270 [0.170, 0.370] |

resolver+LLM - baseline nDCG@10 +0.060 [0.002, 0.120] (distinguishable); v6 dev: 0.491 / 0.509 / 0.545. Judge: 10/10 topics ok, JSON 18/18, coverage 92.0%, 7.4k tokens per patient (v6: 44/48 valid, 81%, 20k tokens). Tier B in the top 10: judge 2 correct, 1 "wrong" (NCT04296942 requires prior front-line THP; the patient is untreated, so the judge follows the text and the TREC label looks mistaken), 1 not relevant; v6 judge: 3 correct, 4 wrong.

## 2. Regression eval (synthetic profiles, title/condition regex labels; a smoke test)

| metric | v6 | v7 |
| --- | --- | --- |
| National pipeline nDCG@10 (40 profiles, 5,726 trials) | 0.775 [0.688, 0.850] | 0.779 [0.690, 0.856] |
| National BM25 / random | n/a | 0.685 / 0.384 |
| Hard-filter oracle, national top 15 | 0 of 600 | 0 of 600 (oracle changed: uncoded sites are "not checkable", disclosed) |
| v2 vs v1 (profiles without ECOG 2) | -0.004 [-0.022, 0.012] | -0.004 [-0.021, 0.014] |

## 3. Vignette benchmark (164 synthetic patients, gold)

`npm run eval:vignettes -- --split=dev|test` against `eval/gold/vignettes-gold-v1.json`: 164 synthetic vignettes, 5,389 pooled (vignette, trial) pairs labelled eligible / possibly / excluded / not_relevant in a primary labeling pass (306 / 852 / 2,814 / 1,417), every evidence quote machine-checked verbatim against the cited criterion. An independent second labeling pass ("judge-b", blind to the primary labels and notes) re-labeled a seeded 20% sample (32 vignettes, 109 chunks, 1,095 pairs): raw agreement 0.902, **Cohen's kappa 0.841** (dev 0.869, test 0.814), relevant-vs-not agreement 0.956. 107 pairs are contested between the two passes (flagged `contested` in the gold file). The pool and the gold were frozen before v7 rankings were added (`scripts/eval/vignettes/add-pipeline.ts`); 93-95% of the v7 top 10s were already pooled, unpooled trials count as non-relevant. **pipeline:v7+resolver** = what the app shows before the AI judge answers. The AI judge arm was not run here (164 patients x ~7k tokens is over the free daily quota).

| split | system | nDCG@10 (graded) | recall@50 eligible | excluded share in top 10 | dNDCG vs v4 |
| --- | --- | --- | --- | --- | --- |
| dev (94) | pipeline:v4 | 0.288 [0.236, 0.345] | 0.791 | 0.560 | ref |
| dev | pipeline:v7 | 0.298 [0.243, 0.354] | 0.804 | 0.584 | +0.010 [-0.017, 0.038] |
| dev | pipeline:v7+resolver | 0.325 [0.267, 0.386] | 0.804 | 0.545 | **+0.038 [0.003, 0.072]** |
| test (70) | pipeline:v4 | 0.307 [0.249, 0.365] | 0.845 | 0.477 | ref |
| test | pipeline:v7 | 0.315 [0.253, 0.377] | 0.854 | 0.525 | +0.008 [-0.024, 0.039] |
| test | pipeline:v7+resolver | 0.295 [0.237, 0.352] | 0.854 | 0.487 | -0.012 [-0.051, 0.027] |

Baselines (dev / test nDCG@10): BM25 0.219 / 0.256, embeddings 0.194 / 0.217, ClinicalTrials.gov search 0.135 / 0.169; the pipeline beats all three, distinguishably, on both splits. The v7 resolver lowers the share of excluded trials in the top 10 on both splits (dev 0.584 to 0.545, test 0.525 to 0.487) and helps nDCG on dev, but on test its nDCG change is not distinguishable from zero and points down (-0.020 [-0.063, 0.020] vs pipeline:v7; -0.023 vs v4 with contested pairs dropped). About half of every system's top 10 is labelled "excluded" by the gold: retrieval finds the right disease, and most of the remaining error is eligibility detail the questionnaire does not capture.

## 4. Production on the free tier (live)

`scripts/eval/matching/live-check.ts`: 5 TREC dev patients judged back to back through the production judge (45 s deadline, real Groq client, token budget, no pacing or cache): 5 of 5 judged, none degraded, coverage 20-100% per patient. Groq's free tier allows 8000 tokens per minute and one patient costs about 7k, so sustained capacity is about one full judgment per minute; patients beyond that get partial AI coverage (the rest stays "unknown", which never lowers a trial) or, when the daily budget is gone, a rules-only reading with a banner saying so.

## 5. Components

| component | v6 | v7 | source |
| --- | --- | --- | --- |
| Cached judge completions the parser reads fully | 3 rejected, 6 silently losing trials | 51/53 ok, 2 empty (re-asked), 0 rejected | `scripts/eval/matching/replay-cache.ts` |
| Items the resolver settles, every question answered (1,000 trials) | 5.3% | 6.1% (target of 12% not reached) | `scripts/eval/resolve-share.ts` |
| Held-out v1 rule-fact precision (100 items) | not measured | prior_* 0-60%, metastatic 70%, newly_diagnosed 50%, previously_treated 60%, pregnancy 90%, concurrent_trial 90% | `eval/facts-labels-v3.json` |
| Criterion items checked at screening (not sent to the judge) | n/a | 15.8% | `lib/match/screening.ts` |

## What improved
- The judge now works: valid output on every completion in v7 runs, per-batch failure isolation, and the first successful held-out result (+0.069 nDCG@10, distinguishable, 7/7 correct demotions).
- Missed exclusions on the held-out set fell from 0.40 to 0.23.
- A pre-existing inversion ("HR-positive" read as HR-negative, 58 criterion items) is fixed.
- Low-precision v1 rule facts can no longer put a trial in Tier B.

## Scope of the evidence
- The benchmarks are TREC human judgements and synthetic vignettes with two independent labeling passes (kappa 0.841).
- The TREC held-out set is 7 topics.
- Free-tier throughput is about one full judgment per minute.
