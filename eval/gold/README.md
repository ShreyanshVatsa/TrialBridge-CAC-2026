# Gold labels for eligibility facts, v1

`gold-v1.json` is an independent label set of what 120 trials' eligibility text requires, for measuring the rule layer
(`lib/ingest/eligibility-facts.ts`) against something that did not come from it.

## Status and limits
- Labeled blind from the criteria text, by non-clinicians. Expect disagreement on judgment calls.
- Labels come from the trial's raw numbered inclusion/exclusion text only. Strict reading: if wording is vague, cohort-specific or
  investigator-dependent, the row is `ambiguous`, or carries `applies_to` and a lower `confidence`.
- 120 trials is small. Rare values (biomarkers, hepatitis `required`) have few examples; per-value precision/recall will be noisy.
- The pool is not the full national set: trials whose criteria text is shorter than 400 or longer than 8,000 characters were excluded
  (very long protocols were skipped for labeling effort), so very long cohort-heavy trials are under-represented.
- The text field is what CT.gov provides. Some criteria are truncated, stripped of symbols (">=", "<" lost in places), or defer to the
  protocol ("as described in the protocol"). Those rows are `low` or `medium` confidence.
- Some trials are not treatment trials (screening devices, supportive care, behavioral). They are kept (the national data has them) and
  mostly come out `not_stated`.

## Method
1. Sample: all trials in `public/data/shards/national-20261008-e97a2aa466/trials/*.json` (5,726), primary group = `card.groups[0]`.
   Excluded: any NCT ID appearing in `eval/`, `scripts/`, `tests/`, `config/questionnaire/precision.generated.ts` at sampling time
   (1,471 IDs; this covers all development and held-out IDs of earlier precision rounds without reading rule code), and trials with
   criteria text outside 400-8,000 chars. Remaining pool: 21 groups.
2. **Seed 20261007**, Python `random.Random`. Pools per group are shuffled (sorted-ID input), then drawn round-robin across the 21 groups
   (alphabetical) until 120 trials: 6 each, except kidney 5, uterine-cervical 5, thyroid 2 (small pools; remainder redistributed).
   Final order shuffled. `sample-gold.py` reproduces it.
3. Labeling: the labeler read only `card.inclusion` and `card.exclusion` (numbered), titles, and age/sex fields. It did **not** read
   `config/criteria.ts`, `lib/ingest/eligibility-facts.ts`, any generated precision file, existing label files' contents, or stored
   `facts`/`barriers` in the data. Allowed reading for schema only: `docs/dev/QUESTIONNAIRE_SPEC.md` s1, `lib/types/trial.ts`,
   `scripts/ingest/fact-precision.ts` (header and plumbing), `config/questionnaire/**` file names.
4. Every `quote` was machine-checked to be a verbatim substring (whitespace-normalised, trailing punctuation ignored) of that trial's
   criteria text. 0 mismatches.

## Blindness
The labeler saw the NCT ID list used for exclusion only as a count/uniqueness filter, never the labels attached to them. It has general
knowledge of the fact schema (value/param, required/excluded/mentioned), which shaped the families, so labels are independent of rule
*behavior* but not of the *schema*.

## Schema
File: `{ meta, trials: [ { trial_id, group, title, labels: [Label] } ] }`. Each trial has, for each of the 10 families, one or more
rows; a family with nothing stated has a single row with `value: "not_stated"` (no quote). A family may have several rows
(e.g. two biomarkers, or different cohorts).

Label fields: `family`, `value`, `param`, `quote`, `scope`, `applies_to`, `confidence` (`high|medium|low`), `note`.

| family | values | param | scope |
|---|---|---|---|
| `lines_of_therapy` | `min_lines`, `max_lines`, `line_range`, `treatment_naive`, `first_line`, `ambiguous`, `not_stated` | number, or "a-b" string | - |
| `prior_drugs` | `required` (must have received), `excluded` (must not have received), `not_stated` | drug class/agent text | `any_history`, `within_N_<unit>`, `current` |
| `stage` | `required`, `excluded`, `not_stated` | stage/setting text (metastatic, locally advanced, adjuvant, resectable, stage IV, ...) | - |
| `relapsed_refractory` | `required`, `excluded`, `not_stated` | text | - |
| `other_cancer` | `excluded`, `allowed` (prior/concurrent malignancy explicitly permitted), `not_stated` | carve-outs | `active_only`, `any_history`, `within_N_years` |
| `hepatitis` | `excluded` (HBV/HCV positive excluded, no carve-out), `allowed_if_controlled` (positive allowed only with undetectable viral load/treated, or active-only exclusion), `required`, `not_stated` | HBV/HCV text | `active_only` |
| `biomarkers` | `required`, `excluded`, `ambiguous`, `not_stated` | marker and status, e.g. "PD-L1 TPS>50%" | - |
| `histology` | `required`, `excluded`, `not_stated` | histology/disease text | - |
| `ecog_max` | `max` (param = highest ECOG allowed), `ambiguous` (only Karnofsky/Lansky given), `not_stated` | number | - |
| `brain_mets` | `excluded` (any), `excluded_active_only` (untreated/active/symptomatic excluded), `allowed_stable_required` (treated and stable ok), `allowed`, `required`, `ambiguous`, `not_stated` | text | - |

Conventions: `applies_to` is set when a criterion covers one cohort/arm/phase/part only. A `treatment_naive`/`first_line` trial also
gets `relapsed_refractory: excluded` (confidence medium, "implied") when it requires newly diagnosed disease. Karnofsky/Lansky-only
criteria are `ecog_max: ambiguous` unless the text equates them to ECOG. Hormonal/radiation exclusions appear under `prior_drugs` with a
note ("radiation, not drug") so the scorer can drop or keep them.

## Using it
Map your fact keys to families (e.g. `min_prior_lines`/`max_prior_lines` -> `lines_of_therapy`, `prior_drug:*` -> `prior_drugs`,
`other_malignancy` -> `other_cancer`, `hepatitis_b|c` -> `hepatitis`, `biomarker:*` -> `biomarkers`, `histology:*` -> `histology`,
`ecog_max`, `brain_mets`, `metastatic|locally_advanced|adjuvant_setting|...` -> `stage`, `recurrent|previously_treated|platinum_*` ->
`relapsed_refractory`). Score `ambiguous` rows as excluded from precision/recall (or report separately). Do not tune rules against
this file: if used for tuning, it stops being independent. Keep it as the held-out check and create v2 for new rounds.

---

# Batch 2: `gold-v2.json` (second independent batch of 120)

`gold-v2.json` extends the set with 120 further trials, same schema, families, conventions and labeling rules as batch 1 (each trial
also carries a `stratum` field). It is a separate file: v1 and v2 are disjoint and can be pooled (240 trials) or scored separately.
Reproduce the sample with `eval/gold/sample-gold-v2.py` (usage in its header).

## Purpose
Batch 1 had few examples of several sparse cases (hepatitis requirements, lines-of-therapy ranges/max, relapsed/refractory, stage
requirements, biomarker requirements/exclusions, other-cancer windows). Half of batch 2 oversamples trials likely to contain them.

## Method
1. Pool: all trials in `public/data/shards/national-20261008-e97a2aa466/trials/*.json` (5,726), primary group = `card.groups[0]`.
   Excluded: the same 1,471 NCT IDs as batch 1 (any ID in `eval/` (excluding `eval/gold/`), `scripts/`, `tests/`,
   `config/questionnaire/precision.generated.ts`, regenerated by ID grep only), **plus all 120 IDs in `gold-v1.json`**; and trials whose
   criteria text is outside 400-8,000 characters (same limits as batch 1). Remaining groups: 19 (kidney and thyroid have no eligible
   trials left after exclusions).
2. **Seed 20261108**, Python `random.Random`. Pools sorted by ID, shuffled per group, drawn round-robin across groups (alphabetical).
3. Strata (recorded in each trial's `stratum`):
   - `keyword` (60): drawn only from trials whose raw inclusion+exclusion text matches a simple case-insensitive keyword regex
     (`KEYWORDS` in the script: hepatitis/HBV/HCV/HBsAg, "line(s) of", prior line, relapsed, refractory, stage, biomarker, mutation,
     PD-L1, HER2, EGFR, ALK, BRAF, KRAS, MSI, BRCA, "positive for"/"negative for", second primary / other or prior malignancy / other
     cancer). The keyword list is deliberately broad ("stage", "mutation"), so this stratum is enriched, not purely sparse-case trials.
   - `random` (60): drawn from the remaining pool (keyword matches not already taken stay eligible), without regard to content.
   Group balance within each stratum is round-robin, so rare groups are over-represented relative to their national share
   (breast/brain/bladder 8 each, other groups 6). Because the keyword stratum is enriched, **do not use batch-2 prevalence as an
   estimate of national prevalence**; score per stratum or only per-value precision/recall.
4. Labeling: same blind protocol as batch 1 (read only each sampled trial's numbered criteria text, title and age/sex fields; did not
   read `config/criteria.ts`, `lib/ingest/eligibility-facts.ts`, `precision.generated.ts`, existing label files, extractor/LLM code, or
   stored facts). Allowed for schema only: this README, `sample-gold.py`, `lib/types/trial.ts`.
5. Every non-null `quote` was machine-checked as a verbatim substring (whitespace-normalised, case-folded, trailing punctuation
   ignored) of that trial's criteria text. 0 mismatches.

## Handling of ambiguity (stricter than "best guess")
- Cohort/arm/phase/part-specific criteria carry `applies_to` and often `confidence: medium|low`; they are not flattened into a
  trial-level rule.
- Alternatives ("one of the following", "or refused") are labeled with a note and lower confidence rather than as hard requirements.
- Text that is truncated, contradictory (e.g. a permission under an "Exclusion" heading) or defers to the protocol gets `low`
  confidence or `ambiguous` (lines, biomarkers, ecog, brain_mets), never a guess.
- CNS involvement of leukemia/lymphoma/myeloma is `brain_mets: ambiguous` (not brain metastases as such).
- Where an inclusion and exclusion criterion conflict on other cancers, both rows are kept with a note.
- Non-oncology and screening/imaging trials are kept; most come out `not_stated`.

## Counts (rows with a stated value, across 120 trials)
Per-value counts and ambiguity totals are computed from the file; see the commit message or re-count with a short script. Totals of
`ambiguous` rows: lines 9, biomarkers 5, ecog_max 13, brain_mets 8 (35 in all).
