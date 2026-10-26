# TrialGPT criterion-split gold check

Checks `lib/ingest/criteria-split.ts` against the pre-split criteria in TrialGPT's `trial_info.json`
(https://ftp.ncbi.nlm.nih.gov/pub/lu/TrialGPT/trial_info.json; NCBI, U.S. government work, public domain).
Cite: Jin Q. et al., "Matching patients to clinical trials with large language models", Nature Communications 15, 9074 (2024).

| File | What |
| --- | --- |
| `sample.json` | 300 trials (every k-th trial of the unchanged-text overlap): our raw CT.gov text + TrialGPT's section strings. |
| `results.json` | Last full-overlap run (`npm run eval:split`). |
| `data/cache/trialgpt/` (gitignored) | `trial_info.json` (1.1 GB, 448,631 trials) and `overlap.json` (7,575 trials we also hold raw text for: 5,755 TREC judged trials + 1,820 national snapshot trials). |

Reproduce: download `trial_info.json` into `data/cache/trialgpt/`, then `npx tsx scripts/eval/trialgpt/extract.ts`
and `npm run eval:split` (`-- --worst=10 [--strict] [--src=national]` prints disagreements). Without the cache it runs on `sample.json`.

Method (scripts/eval/trialgpt/compare.ts): TrialGPT items are the `\n\n` chunks of its strings (under 5 characters and
header chunks dropped, as in TrialGPT's `parse_criteria`). They are flat: every nested bullet and label line is its own
item. They are compared with our flat `splitSegments` layer. `splitCriteria` groups nested lists and "one of the
following" lists into one item on purpose, so its count agreement with the flat gold is reported only for reference.
Boundary F1 matches items by their first 8 normalized words. "Unchanged text" = whole-text word-bigram Jaccard
>= 0.9 between today's registry text and TrialGPT's copy (registry edits since TrialGPT's snapshot make item-by-item
comparison meaningless for the rest).

Results (2026-10-13, full overlap):

| Subset | Trials | Exact item count | Per-section exact | Within 1 | Boundary P / R / F1 | Grouped exact (ref.) |
| --- | --- | --- | --- | --- | --- | --- |
| Unchanged text (primary) | 4,633 | 95.6% | 94.4% | 98.6% | 0.985 / 0.987 / 0.986 | 62.5% |
| Bigram Jaccard >= 0.98 | 1,946 | 98.0% | 96.5% | 99.9% | 0.996 / 0.996 / 0.996 | 43.9% |
| TREC trials, unchanged | 3,860 | 97.2% | 96.0% | 99.1% | 0.988 / 0.991 / 0.989 | 65.8% |
| National trials, unchanged | 773 | 87.5% | 86.4% | 95.7% | 0.974 / 0.976 / 0.975 | 46.1% |
| Text changed since TrialGPT | 2,942 | 62.2% | 60.4% | 70.2% | 0.743 / 0.860 / 0.797 | 42.3% |

Remaining disagreements on the strict subset are mostly TrialGPT artifacts (an exclusion header split into its own
chunk such as "include:" or "(Abbreviated List):", or an inline "exclusion criteria include the following:" inside an
inclusion bullet), plus residual registry edits. This measures segmentation only, not clinical meaning.
