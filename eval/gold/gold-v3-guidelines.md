# Gold v3 labeling guidelines (fact-key schema)

You are labeling what a cancer clinical trial's eligibility criteria say, **for every participant of the trial**, about a fixed
list of patient characteristics ("keys"). Your labels are used to check an automatic reader, so they must come from the criteria
text alone. Read only the trial packet you were given and this file. Do not read any other file in the repository.

## The question behind every label
A patient app asks people simple questions ("Has your cancer spread to distant organs?", "Have you ever had chemotherapy?",
"Have you had radiation?", "How many lines of treatment have you had?"). For each key, decide what the trial's text implies for a
person answering that question:

- `required`: **every** participant must have this (or, for a numeric key, must be within this limit). A person who does not have
  it cannot join.
- `excluded`: having this rules a person out (see `scope` for how much of it).
- `conditional`: the text mentions it, but no rule applies to every participant. Use this when the rule is limited to one
  cohort / arm / part / phase / sub-population ("Cohort B: ...", "Part 2 only", "for patients with HER2+ disease, ..."), when it is
  one of several alternatives ("metastatic **or** unresectable", "prior chemotherapy **or** immunotherapy", "one of the
  following"), when it is merely permitted ("prior radiation is allowed"), when it depends on investigator judgment, when it is a
  definition or example ("e.g. chemotherapy"), when it refers to the future (planned/scheduled/candidate for surgery), or when you
  cannot tell.
- Not stated: leave the key out entirely.

Strictness: only label `required` / `excluded` when a careful reader would agree the rule applies to the whole trial population.
When in doubt, use `conditional`. Ignore lab-value thresholds (ANC, creatinine, bilirubin...) unless a key below says otherwise.

## Scope (for `excluded`) and param
- `scope: "any"`: anyone who has or ever had it is excluded ("No prior chemotherapy", "Known HIV infection", "History of
  autoimmune disease").
- `scope: "window"`: only a recent or current exposure is excluded: a stated time window before enrollment / first dose /
  randomization ("chemotherapy within 4 weeks", "major surgery within 28 days"), or current/ongoing use ("currently receiving").
  Put the window in `param` as text, e.g. `"28 days"`, `"current"`.
- `scope: "active"`: only active / untreated / uncontrolled / symptomatic / unstable / detectable disease is excluded; treated,
  stable, controlled or resolved cases may join (e.g. "untreated or symptomatic brain metastases", "active hepatitis B",
  "uncontrolled HIV", "active autoimmune disease requiring systemic treatment in the past 2 years").
- `scope: "years"`: other_malignancy only: other cancers diagnosed/treated within N years are excluded. `param`: the number N.
- `scope: "limited"`: the exclusion covers only part of the key: specific agents within a class ("prior gemcitabine" for
  prior_chemotherapy), a specific setting ("prior systemic therapy **for metastatic disease**", "radiation **to the target
  lesion**", "radiation to > 25% of bone marrow"), a count ("more than 2 prior regimens"), or another qualifier.
- `required` rows normally have no scope. Numeric keys use `param` (a number).

## Keys
Disease extent and status
- `metastatic`: distant spread / stage IV / M1. required = all participants must have metastatic (stage IV) disease
  ("metastatic castration-resistant prostate cancer", "stage IV NSCLC"). excluded = distant metastases rule a person out
  ("no distant metastases", "non-metastatic", "M0", "stage I-III"). Brain-metastasis-only rules are NOT this key (use
  `brain_mets`). "advanced or metastatic", "metastatic or unresectable", "locally advanced or metastatic" = conditional.
- `locally_advanced`: required only when the trial is for locally advanced (non-metastatic) disease only.
- `adjuvant_setting`: required = all participants must have had their tumor completely removed / no evidence of disease
  (adjuvant or post-resection trials).
- `resectable`: required = must have resectable disease / be a surgical candidate; excluded = resectable disease rules a person out
  (must be unresectable).
- `recurrent`: required = every participant must have relapsed / refractory / recurrent / progressive disease after previous
  treatment. excluded = recurrent or relapsed disease rules a person out (e.g. only newly diagnosed / primary disease).
- `newly_diagnosed`: required = must be newly diagnosed or previously untreated for this cancer.
- `previously_treated`: required = must have received at least one prior anticancer treatment for this cancer. excluded = any
  prior anticancer treatment for this cancer rules a person out (scope as usual).
- `min_prior_lines` / `max_prior_lines`: total prior lines/regimens of systemic therapy for this cancer (not counts of one drug
  class; those are `limited` or conditional). `value: "required"`, `param`: the number. "At least 2 prior lines" =>
  min_prior_lines 2. "No more than 3 prior regimens" => max_prior_lines 3. "1-3 prior lines" => both. "Treatment-naive / first
  line" => max_prior_lines 0 (and newly_diagnosed required, previously_treated excluded).

Prior treatment (any setting, for this cancer unless the text says otherwise)
- `prior_chemotherapy`, `prior_radiation`, `prior_surgery`, `prior_immunotherapy` (checkpoint inhibitors, cancer vaccines, cell
  therapies, cytokines), `prior_targeted_therapy` (kinase inhibitors, targeted antibodies such as anti-HER2/anti-EGFR/anti-VEGF,
  PARP inhibitors, ADCs).
  - required = must have previously received it (a specific agent of that type counts: "must have progressed on platinum-based
    chemotherapy" => prior_chemotherapy required). "Must have undergone complete resection" => prior_surgery required.
  - excluded with scope any / window / limited as defined above. "No prior systemic therapy" => prior_chemotherapy,
    prior_immunotherapy and prior_targeted_therapy excluded (any), previously_treated excluded. A biopsy is not surgery.
  - Planned or future treatment ("candidate for surgery", "scheduled to receive radiation", "will receive chemoradiation on study")
    is NOT prior treatment: conditional or leave out.
- `prior_drug:<class>` for these classes only: checkpoint, platinum, taxane, endocrine, cdk46, anti_her2, adc, egfr_tki, alk_tki,
  parp, arpi (abiraterone/enzalutamide/apalutamide/darolutamide), lu_psma, braf_mek, anti_vegf, vegf_tki, fluoropyrimidine, hma,
  venetoclax, car_t, anti_cd20, btk, bispecific, anti_cd38, imid, proteasome_inhibitor, bcma, temozolomide, bcg, auto_sct.
  Same values and scopes; a single named agent excluded ("prior pembrolizumab") is `limited` for the class.

Performance and disease features
- `ecog_max`: required, param = the highest ECOG allowed for everyone (if cohorts differ, the most lenient). If only Karnofsky /
  Lansky is given convert the minimum score: >= 90 -> 0, 70-80 -> 1, 50-60 -> 2, 30-40 -> 3. If ECOG and Karnofsky are
  alternatives, take the more lenient.
- `brain_mets`: excluded (scope any or active), required (must have brain metastases), or conditional.
- `measurable_disease`: required = must have measurable disease (RECIST etc.); excluded = must NOT have measurable disease.

Other conditions
- `other_malignancy`: other (second) cancers. excluded with scope any / years (param N) / active ("unless curatively treated", "no
  evidence of disease", "not requiring treatment" => active).
- `hiv`, `hepatitis_b`, `hepatitis_c`: excluded (scope any or active: "active", "uncontrolled", "detectable viral load",
  "unless on suppressive therapy with undetectable viral load") or required.
- `organ_transplant` (prior solid organ transplant), `allo_sct` (prior allogeneic stem cell transplant): required / excluded with
  scope.
- `autoimmune`: excluded (scope any or active).
- `heart_disease`, `kidney_disease`, `liver_disease`: excluded when a named disease or clinically significant condition of that
  organ rules a person out (not lab values alone). Scope any or active.
- `castration_resistant` (prostate): required = must be castration-resistant; excluded = castration-resistant disease rules a person
  out (castration-sensitive only). `platinum_resistant`, `platinum_sensitive` (ovarian etc.), `mibc` (muscle-invasive bladder):
  same pattern.
- `pregnancy`: excluded when pregnant (or breastfeeding) people are excluded.
- `concurrent_trial`: excluded when participation in another interventional trial rules a person out.

Diagnosis
- `histology:<id>` for these ids only: nsclc, sclc, lung_squamous, mesothelioma, aml, all, cll, cml, mds, dlbcl, follicular,
  mantle_cell, marginal_zone, hodgkin, t_cell_lymphoma, cns_lymphoma, smoldering_myeloma, amyloidosis, endometrial, cervical, hcc,
  biliary, esophageal_squamous, gastroesophageal_adeno, pdac, pnet, glioblastoma, lower_grade_glioma, meningioma, uveal_melanoma,
  mucosal_melanoma, cutaneous_scc, merkel_cell, clear_cell_rcc, gist, osteosarcoma, ewing, differentiated_thyroid,
  medullary_thyroid, anaplastic_thyroid, hnscc, nasopharyngeal, salivary, rectal, anal, hgsoc, ovarian_clear_cell,
  low_grade_serous_ovarian, prostate_neuroendocrine, upper_tract_urothelial.
  required = the trial enrolls ONLY this histology (a list of several eligible histologies => conditional for each). excluded = this
  histology rules a person out ("small cell histology excluded", "uveal melanoma excluded").
- `biomarker:<id>` for: HER2, HR, BRCA, EGFR, ALK, ROS1, KRAS, BRAF, PD-L1, MSI-H, NTRK, FLT3, IDH, MET, RET, HPV, CLDN18, PH,
  NPM1, TP53, MGMT, PIK3CA, ESR1, PALB2, KIT. required = every participant must be positive / altered. excluded = being positive /
  altered rules a person out (also when the text requires the negative status, e.g. "HER2-negative" => biomarker:HER2 excluded;
  "triple-negative" => HER2 excluded and HR excluded). Several markers offered as alternatives => conditional.

## Output
Write one JSON file (path given in your task) with this shape, one entry per trial in the packet, in packet order:

```json
{ "labeler": "<your model name>", "trials": [
  { "trial_id": "NCT00000000", "labels": [
    { "key": "metastatic", "value": "required", "quote": "Histologically confirmed metastatic ...", "ref": "I2" },
    { "key": "prior_chemotherapy", "value": "excluded", "scope": "window", "param": "28 days", "quote": "Chemotherapy within 28 days", "ref": "E4" },
    { "key": "ecog_max", "value": "required", "param": 1, "quote": "ECOG performance status 0-1", "ref": "I5" }
  ] }
] }
```

- `quote` must be copied **verbatim** from one criterion (a contiguous excerpt; it will be machine-checked). `ref` is the
  criterion id shown in the packet (I = inclusion, E = exclusion, then its number).
- One row per key. If a key has several relevant criteria, label the trial-level outcome and quote the decisive one; if they
  conflict or differ by cohort, use `conditional`.
- Optional `note` (short) when the call was hard.
- Label every key the text speaks to; leave unmentioned keys out. Do not guess.
