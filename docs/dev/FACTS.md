# Rule facts: how precise each one is, and what matching lets it do

The rule extractors (`lib/ingest/eligibility-facts.ts`, `lib/ingest/llm-families.ts`) read criterion text with
patterns. Some fact keys are precise, some are not. This page states how precise each one is. The numbers are generated: `config/questionnaire/precision.generated.ts` (families, from
`eval/facts-labels-v2.json` and `eval/llm-gold-results.json`) and `config/questionnaire/precision-v1.generated.ts`
(v1 keys, held-out labels in `eval/facts-labels-v3.json`). "Held-out labels" were made item by item on a random sample, following written labeling guidelines; "blind gold"
sets were labeled from the criterion text alone, without access to extractor output. Samples are 10 to 51 items per key, so each precision is approximate (about +-10 to 15 points).

The gate (`config/questionnaire/fact-policy.ts`): a fact may lower a trial only when its measured precision is at
least 85%. Below the gate a family is support-only (it can raise a trial's fit, never lower it); a v1 key below the
gate keeps a half-weight ranking penalty (removing it measurably hurt TREC dev) but can never make a hard failure. The
per-item resolver (`lib/match/resolve/`) applies the same rule: a below-gate fact settles an item only through the
narrower, item-level checks (stage, treated status, precise line counts, histology and health-history wording) that
have their own tests.

| family | example keys | labeled | precision | label source | how matching uses it |
| --- | --- | --- | --- | --- | --- |
| performance | `ecog_max` | 50 | 100% | held-out labels | penalize (weight 1) |
| brain_mets | `brain_mets` | 49 | 96% | held-out labels | penalize (weight 1) |
| histology | `histology:*` | 39 | 67% | held-out labels | support only (never lowers a trial) |
| lines | `min_prior_lines`, `max_prior_lines` | 21 | 81% | blind gold | support only (never lowers a trial) |
| prior_drug | `prior_drug:*` | 41 | 66% | blind gold | support only (never lowers a trial) |
| measurable | `measurable_disease` | 49 | 92% | held-out labels | penalize (weight 0.5) |
| recurrent | `recurrent` | 42 | 83% | blind gold | support only (never lowers a trial) |
| other_malignancy | `other_malignancy` | 29 | 97% | blind gold | penalize (weight 0.5) |
| hiv | `hiv` | 48 | 88% | held-out labels | penalize (weight 1) |
| hepatitis | `hepatitis_b`, `hepatitis_c` | 51 | 80% | blind gold | support only (never lowers a trial) |
| transplant | `organ_transplant`, `allo_sct` | 50 | 94% | held-out labels | penalize (weight 1) |
| autoimmune | `autoimmune` | 50 | 94% | held-out labels | penalize (weight 1) |
| organ_disease | `kidney_disease`, `liver_disease`, `heart_disease` | 49 | 100% | held-out labels | penalize (weight 0.5) |
| group_status | `castration_resistant`, `platinum_resistant`, `platinum_sensitive` | 47 | 89% | held-out labels | penalize (weight 1) |
| stage | `locally_advanced`, `adjuvant_setting` | 3 | 100% | blind gold | support only (never lowers a trial) |
| biomarker_v2 | `biomarker:MET`, `biomarker:RET`, `biomarker:HPV` | 2 | 100% | blind gold | support only (never lowers a trial) |

| v1 key | labeled | precision | how matching uses it |
| --- | --- | --- | --- |
| `prior_chemotherapy` | 10 | 20% | half-weight penalty, never a hard failure |
| `prior_radiation` | 10 | 0% | half-weight penalty, never a hard failure |
| `prior_surgery` | 10 | 30% | half-weight penalty, never a hard failure |
| `prior_immunotherapy` | 10 | 60% | half-weight penalty, never a hard failure |
| `prior_targeted_therapy` | 10 | 10% | half-weight penalty, never a hard failure |
| `metastatic` | 10 | 70% | half-weight penalty, never a hard failure |
| `newly_diagnosed` | 10 | 50% | half-weight penalty, never a hard failure |
| `previously_treated` | 10 | 60% | half-weight penalty, never a hard failure |
| `pregnancy` | 10 | 90% | penalize (weight 1) |
| `concurrent_trial` | 10 | 90% | penalize (weight 1) |

Reading the table: `prior_*` v1 keys have low precision (0 to 60%) because criterion text mentions treatments in many roles
(washout windows, allowed prior therapy, toxicity recovery). They are why the resolver reads treated status from whole
items instead (`lib/match/resolve/treated.ts`). Families with very few labels (`stage`, `biomarker_v2`) stay support-only
until they are measured on more items.

Regenerate after relabeling: `npx tsx scripts/ingest/fact-precision.ts --measure` and
`npx tsx scripts/ingest/v1-precision.ts --measure`.
