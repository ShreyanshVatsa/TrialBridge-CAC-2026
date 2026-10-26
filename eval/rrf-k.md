# RRF k: dev-split comparison

Command: `RRF_K=<k> npx tsx scripts/eval/trec/pipeline.ts` (full pipeline, structured answers, graded nDCG@10 vs TREC qrels).
Dev split = TREC 2021 cancer topics only (10 topics, mean of the per-topic pipeline column). TREC 2022 (test) was not used.

| k | mean nDCG@10, 2021 (10 topics) |
| --- | --- |
| 20 | 0.4907 |
| 60 (previous) | 0.4871 |

Difference is +0.0036, small relative to per-topic spread on 10 topics; no significance test run. k=20 kept.
Vignette dev split: not run, eval/gold/vignettes-gold-v1.json is absent in this checkout.
Note: fusion weights were fit with k=60 features and were not refit.
