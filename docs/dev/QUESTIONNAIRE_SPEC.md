# TrialBridge Smart Questionnaire: Design Spec (v2, cancer only)

Scope: an adaptive questionnaire, in place of a fixed 10-step chat intake, whose questions are data (`config/questionnaire/`), so non-cancer areas can be added later as new catalogs. It also covers two addenda: non-response as a first-class feature (§2.4, §5.3) and a data-driven i18n platform for many languages (§6).
Unchanged rules: no AI in intake; answers never leave the browser except through the minimized profile; never say "eligible" or "qualify"; "not sure" never penalizes; hard filters stay absolute; there is no free text in intake.

---

## 0. Evidence: what gates eligibility in the national data

Source: `public/data/shards/national-20261007-d5ef8be42a`, **5,726 unique trials** (union of the full shards, deduplicated). Method: case-insensitive regexes over each trial's numbered inclusion and exclusion criteria. "any" means the trial mentions the attribute anywhere; "inc" and "exc" are the section. A mention is an upper bound on gating: it means the attribute appears, not that a rule was parsed. Directional coverage comes from the existing rule facts. Percentages are of trials in the group.

### 0.1 Cross-cancer attributes (all 5,726 trials)
| Attribute | any | inc | exc | Notes |
|---|---|---|---|---|
| Performance status (ECOG/Karnofsky) | **67%** | 66% | 2% | ECOG ceiling in inclusion: ≤1 in 1,478 trials, ≤2 in 1,309, ≤0 in 153, ≤3-4 in 112. KPS ≥60 (292), ≥70 (211). **The 1-vs-2 cut splits the set roughly in half.** |
| Pregnancy / breastfeeding | 62% | 36% | 51% | Directional `pregnancy:excluded` in 3,411 trials. Mostly irrelevant to men and older women. |
| Metastatic / advanced / unresectable | 54% | 44% | 36% | 68-83% in solid groups, 11-24% in blood cancers. |
| Other active or prior cancer | 49% | 14% | 42% | Usually exclusion, with "unless treated more than N years ago" carve-outs. |
| Heart / kidney / liver function | 46 / 46 / 42% | | | Mostly lab thresholds (creatinine, bilirubin, LVEF, QTc) that patients cannot self-report. |
| Relapsed / refractory / recurrent / progressed | 42% | 35% | 14% | 54-58% in leukemia, lymphoma, ovarian, sarcoma. |
| Measurable disease (RECIST, RANO, Lugano, IMWG, PCWG) | 39% | 39% | 2% | 55-61% in lung, melanoma, kidney, liver, myeloma. |
| HIV | 39% | 10% | 31% | 57-59% in leukemia and lymphoma. |
| Hepatitis B/C | 35% | 10% | 27% | 44% in liver (both directions). |
| Brain / CNS metastases | 31% | 8% | 26% | 52-56% in lung, melanoma, kidney, liver, gastroesophageal. **579 of the 1,469 exclusion mentions carve out treated/stable metastases**, so the answer needs three values: none, treated/stable, active. |
| Transplant (organ or allogeneic SCT) | 26% | 8% | 21% | 52-56% in blood cancers. |
| Autoimmune disease | 23% | 2% | 21% | 37-45% where checkpoint inhibitors dominate (bladder, kidney, liver, melanoma). |
| Newly diagnosed / treatment-naive | 23% | 13% | 12% | |
| Concurrent other trial | 22% | 2% | 20% | |
| Line of therapy (counted lines) | 20% | 18% | 2% | 29-39% in lung, ovarian, lymphoma, myeloma, gastroesophageal. |
| Prior PD-1/PD-L1/CTLA-4 | 16% | 10% | 10% | 31-47% in lung, melanoma, bladder, kidney, liver. |
| Structured sex | 517 FEMALE, 383 MALE, 4,826 ALL | | | Breast 252/734 (34%) female-only; prostate 368 male-only; ovarian 133 and uterine 128 female-only. **Not filtered today.** |
| Structured age | minAge >18: 413, <18: 414; maxAge <75: 511 (191 ≤25) | | | Age gates rarely for adults: keep it as an essential hard filter, not for splitting. |
| Phase | P1 2,007, P2 2,457, P3 512, Early P1 148, NA 1,358 | | | Soft preference only. |
| Sites | median 2 per trial; **2,852 (50%) single-site** | | | Travel distance is the strongest hard filter after cancer type. |

### 0.2 Per-group gating attributes (any-mention %, n = trials in group)
| Group (n) | Strongest gates (any %) | Prior-therapy classes (any %) |
|---|---|---|
| breast (734) | HER2 46, HR/ER/PR 38, TNBC 21, early stage 30, female-only 34, PD-L1 8, BRCA 6, PIK3CA/AKT 5, HER2-low 4 | endocrine 28, CDK4/6 15, anti-HER2 13, ADC 13 |
| lung (681) | brain mets 56, measurable 55, SCLC vs NSCLC 43, EGFR 31, squamous 30, PD-L1/TPS 27, ALK 20, ROS1 12, KRAS 12, HER2 11, BRAF 8, MET 7, RET 7, NTRK 5 | checkpoint 31, platinum 26, TKI 12 |
| colorectal (419) | MSI/dMMR 26, rectal vs colon 25, RAS 17, HER2 9, BRAF 8, anal 8 | fluoropyrimidine/irinotecan 22, anti-VEGF 11 |
| prostate (469) | PSA 46, castration status 36, Gleason/risk 33, PSMA 30, testosterone 30, neuroendocrine 25, BRCA/HRR 5, MSI 1 | ARPI/ADT 58, taxane 19, Lu-PSMA 15, PARP 9 |
| melanoma (267) | uveal/mucosal/acral 30, resected/adjuvant 27, PD-L1 26, BRAF 22, **NRAS 1, KIT 1** | checkpoint 47, BRAF/MEK 14 |
| ovarian (272) | high-grade serous 31, platinum-sensitive/resistant 27, other histology 26, BRCA/HRD 18, FRα 6 | platinum 44, bevacizumab 18, PARP 16 |
| pancreatic (242) | adenocarcinoma vs NET 62, resectable/borderline/LA 41, KRAS 14, BRCA/PALB2 6, MSI 3 | FOLFIRINOX/5-FU 19 |
| leukemia (626) | subtype AML/ALL/CLL/CML/MDS 82, MRD 17, CD19/22/33 13, FLT3 12, Ph+/BCR-ABL 11, IDH 8, NPM1 6, TP53 6 | HMA/venetoclax 32, allo-SCT 47, CAR-T 15 |
| lymphoma (540) | subtype 67, CD19/20/30 34, CNS involvement 29 | SCT 48, CAR-T 32, anti-CD20 21, BTK 16, bispecific 12 |
| myeloma (308) | smoldering/MGUS/amyloid 42, triple-class refractory 17, high-risk cytogenetics 6 | CD38/IMiD/PI 48, SCT 47, CAR-T 28, BCMA/bispecific 25 |
| brain (422) | GBM vs lower grade 59, recurrent vs new 49, secondary brain mets 20, IDH 18, MGMT 7 | prior radiation 72, bevacizumab 20, temozolomide 17 |
| bladder (306) | PD-L1 23, NMIBC vs MIBC 22, upper tract 20, BCG 14, cisplatin-ineligible 7, FGFR 3 | checkpoint 39, ADC 13 |
| kidney (166) | clear cell vs other 39, IMDC risk 5 | checkpoint 44, TKI/VEGF 20 |
| liver (232) | HCC vs biliary 68, hepatitis 44, portal vein/transplant 39, Child-Pugh 31, BCLC 9, FGFR2/IDH1 3 | checkpoint 35 |
| head-neck (423) | recurrent/metastatic vs locally advanced 41, subsite 38, HPV/p16 23, PD-L1/CPS 19 | checkpoint 25, platinum 21 |
| gastroesophageal (197) | gastric/GEJ/esophageal 62, adeno vs squamous 58, HER2 31, PD-L1/CPS 23, MSI 9, Claudin 18.2 6 | platinum 26, 5-FU 18 |
| uterine-cervical (244) | endometrial vs cervical 80, histology 29, PD-L1 16, HER2 11, MSI 11, HPV 6, p53/POLE 4 | platinum 24, checkpoint 24 |
| sarcoma (227) | subtype 40, KIT/PDGFRA 5 | |
| thyroid (45) | subtype 38, RAI-refractory 36, BRAF 22, RET 11, NTRK 9 | |
| solid-tumors (1,212) | exhausted standard therapy 17, HER2 12, fusions 7, KRAS 6, BRAF 6, MSI/TMB 5 | |

### 0.3 Existing directional fact coverage (rule layer, `required` or `excluded`, after the BUGS H2 fixes)
breast: pregnancy 58%, HER2 38%, metastatic 38%, HR 32%, previously_treated 25%. lung: previously_treated 32%, metastatic 28%, prior_immunotherapy 19%, EGFR 15%. prostate: metastatic 47%. leukemia: previously_treated 41%, newly_diagnosed 23%. lymphoma: previously_treated 48%. Overall: 22,415 rule facts and 13 LLM facts, 3.9 facts per trial, 591 trials with no facts. Fact precision on the seed sample is 66% (eval/RESULTS.md).

### 0.4 Consequences for the design
1. **Missing facts.** The highest-value new attributes have no facts today: ECOG ceiling, brain-mets policy, measurable disease, histology/subtype, line count, specific prior drug classes, HIV/hepatitis/transplant/autoimmune/other cancer, castration status, platinum sensitivity. A question with no backing fact cannot move ranking (only the BM25/embedding text). The fact layer must extract them, or the question stays off (`enabled: false` in the catalog).
2. **Group-specific biomarker lists.** Today's `BIOMARKERS_BY_GROUP` is close but not evidence-ordered. Add MET/RET/HER2 for lung, HPV/p16 for head-neck, Claudin 18.2 for gastroesophageal, Ph+/NPM1/TP53 for leukemia, MGMT for brain, RET for thyroid. Drop melanoma NRAS and KIT (1%) and prostate MSI (1%) from the default flow.
3. **Subtype is the top splitter after the essentials** in leukemia (82%), uterine-cervical (80%), liver (68%), lymphoma (67%), gastroesophageal (62%), pancreatic (62%), brain (59%) and lung (43%). It is asked before biomarkers there.
4. **Daily activity (ECOG)** applies to 67% of trials with a near-even ≤1 vs ≤2 split, so it is the best cross-cancer question after spread and treatment status.
5. **Sex** is a structured, reliable field. Treat it as a hard filter only when the answer is definite, and ask it only when at least 5% of current candidates are sex-restricted (breast and solid-tumors in practice).
6. **Lab-based organ function** cannot be answered reliably by patients. Ask only a coarse "a doctor has told me I have serious kidney/liver/heart problems" in Deep-dive, and match it only to exclusion facts that name the disease (heart failure, dialysis, cirrhosis), never to lab thresholds.

---

## 1. Question catalog (config as data)

### 1.1 Files
- `config/questionnaire/types.ts`: types (§1.2).
- `config/questionnaire/common.ts`: cross-cancer questions.
- `config/questionnaire/cancer/<group>.ts`: one file per group with subtype, biomarker, status and drug-class questions, plus answer priors.
- `config/questionnaire/index.ts`: `getCatalog(area: "cancer", group: CancerGroupId): readonly QuestionDef[]`. A future disease area is a new folder (`config/questionnaire/<area>/`) plus an `area` value; there are no engine changes.
- `config/questionnaire/find-out.ts`: "Find out at your next appointment" items (§5.3).

### 1.2 Types (contract C1)
```ts
export type Tier = "essential" | "helpful" | "deep";
export type AnswerType = "group_picker" | "age" | "zip" | "travel" | "single" | "multi" | "biomarker_grid";
/** Reserved option ids. Every non-essential question MUST include "unknown"; "prefer_not" on sensitive ones. */
export const UNKNOWN = "unknown", PREFER_NOT = "prefer_not", SKIP = "__skip";
export interface OptionDef { id: string; labelKey: MessageKey; helpKey?: MessageKey; exclusiveWith?: string[] }
export interface Prereq { question: QuestionId; anyOf: string[] }            // all prereqs must hold
export type FactRelation = "conflict" | "support" | "neutral";
/** How one option relates to one trial fact. `param` comparisons cover thresholds (ECOG, lines). */
export interface FactRule {
  fact: FactKey;                                   // e.g. "ecog_max", "histology:sclc", "prior_drug:cdk46"
  whenRequired?: FactRelation; whenExcluded?: FactRelation;
  paramCompare?: { op: "lte" | "gte"; value: number; else: FactRelation }; // ecog 2 vs trial ecog_max 1 => conflict
}
export interface OptionEffect { option: string; facts: FactRule[]; queryTerms?: string[] /* English, for BM25 + embedding text */; hardFilter?: HardFilterPatch }
export interface QuestionDef {
  id: QuestionId; area: "cancer"; tier: Tier; type: AnswerType;
  labelKey: MessageKey; helpKey: MessageKey; whyKey: MessageKey;            // plain language, grade 6-8
  findOutKey?: MessageKey;                                                   // shown in the "find out" list when unknown
  options?: OptionDef[]; biomarkers?: BiomarkerId[];
  appliesTo: readonly CancerGroupId[] | "all"; excludeGroups?: readonly CancerGroupId[];
  prerequisites?: Prereq[];
  cost: 1 | 2 | 3;               // 1 = most patients know it, 2 = may need to think or check, 3 = usually needs a report
  sensitive?: boolean;           // HIV, hepatitis, pregnancy: adds prefer_not (a prefer-not answer is never sent; v7: definite answers are sent as categories)
  effects: OptionEffect[];
  aiField?: AiFieldId;           // present only if the coarse answer may go to AI (§4)
  priors?: Partial<Record<CancerGroupId, Record<string, number>>>; // P(option), including unknown; used by the engine
  enabled: boolean;              // false until the backing facts pass the precision gate (§7)
  evidence: string;              // e.g. "lung 31% EGFR mention (national 2026-10-07)"
}
```
Validation (unit-tested): every option has an effect; `unknown`, `prefer_not` and `__skip` have **no** facts, query terms or hard filters (enforced by a zod refinement over the catalog); every key exists in `en` messages; prerequisites reference earlier questions only, with no cycles.

### 1.3 Catalog (v2 cancer)
Tier E = Essentials (cannot be skipped, they are hard filters). H = Helpful (asked adaptively in quick mode). D = Deep-dive (asked in thorough mode, or when the patient taps "Add more detail"). Every H and D question offers "Not sure" plus "Skip"; sensitive ones also offer "Prefer not to say".

| id | Tier | Applies | Prereq | Options (plus unknown) | Maps to facts / filters | Evidence |
|---|---|---|---|---|---|---|
| cancer_type | E | all | - | searchable groups, "Other / not sure" | hard: group; shard choice | - |
| age | E | all | - | 18-110; under 18 goes to the pediatric message (kept) | hard: min/maxAge | - |
| zip | E | all | - | 5-digit ZIP (validated, BUGS M6 behavior kept) | hard: distance origin | 50% single-site |
| travel | E | all | zip | 25/50/100/250/500/anywhere | hard: distance | - |
| subtype | H | groups in §0.2 with subtype ≥25% | cancer_type | per group (e.g. lung: NSCLC adenocarcinoma, NSCLC squamous, small cell, mesothelioma) | `histology:<id>` req/exc + query terms | 43-82% |
| spread | H | solid groups | - | not spread / spread nearby (locally advanced) / spread to distant organs / removed by surgery, no cancer seen now | metastatic, locally_advanced, adjuvant_setting | 54-83% |
| disease_status | H | all | - | newly diagnosed, not treated yet / treated and it came back or grew / currently being treated | newly_diagnosed, previously_treated, recurrent | 23% / 42% |
| treatments | H | all | - | existing multi-select (chemo, radiation, surgery, immunotherapy, targeted, hormone therapy [new], stem cell transplant [new, blood], none) | prior_* facts (existing) | 46-51% |
| lines | H | all | disease_status=treated or treatments≠none | 1 / 2 / 3 or more "treatment plans" | `min_prior_lines` / `max_prior_lines` with param | 20% (29-39% in 5 groups) |
| daily_activity | H | all | - | "usual activities, little or no limits" (ECOG 0-1) / "take care of myself but rest during the day" (2) / "need help with self-care, mostly in bed or chair" (3-4) | `ecog_max` param (lte) | 67% |
| biomarkers | H | per group list (§0.4.2), ordered by evidence | cancer_type | grid: positive / negative / not tested / don't know; breast adds a "triple-negative" shortcut | `biomarker:<ID>` (existing logic) | breast HER2 46%, lung EGFR 31% |
| brain_mets | H | solid groups | spread ∈ {distant, unknown} | no / yes, treated and stable / yes, active or not treated yet | `brain_mets` req/exc with `param: "active_only"` carve-out | 31% (56% lung) |
| group_status | H | prostate, ovarian, bladder, myeloma, pancreatic, thyroid | per group | prostate: still responds to hormone therapy (CSPC) / grows despite it (CRPC); ovarian: came back <6 months after platinum (resistant) / ≥6 months (sensitive); bladder: in the muscle wall or not; myeloma: active myeloma / smoldering / MGUS / amyloidosis; pancreas: surgeon said removable / borderline / not removable; thyroid: radioactive iodine stopped working | castration_resistant, platinum_resistant/sensitive, mibc, histology:smoldering, resectability, rai_refractory | 22-42% |
| prior_drugs | H | group-specific (§0.2 right column) | treatments includes the matching class or unknown | multi-select of 3-6 named classes with brand examples, plus "none of these" | `prior_drug:<class>` req/exc | breast endocrine 28%, melanoma checkpoint 47%, myeloma CD38/IMiD/PI 48% |
| sex | H | only when ≥5% of candidates are sex-restricted | - | female / male / prefer not to say (no filter) / unknown | hard filter only on a definite answer (trial.sex) | breast 34% female-only |
| pregnancy | H | sex ≠ male, age < 60 | - | yes / no / not sure / prefer not | pregnancy (existing) | 62% |
| measurable | D | solid, myeloma, lymphoma | spread ≠ adjuvant | "scans show a tumor doctors can measure" yes / no | measurable_disease req | 39% |
| other_cancer | D | all | - | no / yes, treated over 2 years ago / yes, recent or active | other_malignancy exc (carve-out param years) | 49% |
| hiv | D (sensitive) | all | - | no / yes, controlled on medicine / yes, other / prefer not | hiv exc (param: "uncontrolled_only" carve-out) | 39% |
| hepatitis | D (sensitive) | all | - | no / hepatitis B / hepatitis C / prefer not | hepatitis_b, hepatitis_c exc | 35% |
| transplant | D | all | - | none / organ transplant / stem cell transplant from a donor / from my own cells | organ_transplant, allo_sct exc/req | 26% (52-56% blood) |
| autoimmune | D | all; first in checkpoint-heavy groups | - | no / yes (lupus, rheumatoid arthritis, Crohn's...) | autoimmune exc | 23% (37-45%) |
| organ_problems | D | all | - | multi: serious kidney (incl. dialysis), liver (incl. cirrhosis), heart (heart failure, recent heart attack) / none | kidney_disease, liver_disease, heart_disease exc (disease-named criteria only) | 42-46% mention, mostly labs |
| in_other_trial | D | all | - | yes / no | concurrent_trial (existing) | 22% |
| phase_pref | D | all | - | open to first-in-human (phase 1) studies / prefer later-phase / no preference | soft score only, no facts | P1 2,007 trials |
| deep_biomarkers | D | rarer markers (prostate BRCA/HRR, breast PIK3CA/ESR1, pancreas BRCA/PALB2, sarcoma KIT) | biomarkers asked | grid | biomarker facts (new IDs) | 1-9% |

Language: not asked in the flow. It defaults to the UI language, with a "Language you'd like to talk with the study team in" chip on the summary card; this keeps the `languageWarning` behavior.
Help text examples (`en`): daily_activity.help: "Doctors call this 'performance status.' Many studies only include people who are up and about most of the day." lines.help: "A treatment plan is one set of medicines given together, like 'chemo for 4 months.' Count each new plan after the cancer grew."

### 1.4 New fact keys and BiomarkerId additions (contract C2, `lib/types/trial.ts`)
`FactSchema` gains an optional `param: z.union([z.number(), z.string()]).optional()`. New `BASE_FACT_KEYS`: `ecog_max`, `brain_mets`, `measurable_disease`, `min_prior_lines`, `max_prior_lines`, `recurrent`, `locally_advanced`, `adjuvant_setting`, `castration_resistant`, `platinum_resistant`, `platinum_sensitive`, `mibc`, `resectable`, `rai_refractory`, `other_malignancy`, `hiv`, `hepatitis_b`, `hepatitis_c`, `organ_transplant`, `allo_sct`, `autoimmune`, `kidney_disease`, `liver_disease`, `heart_disease`. Template keys: `histology:<HistologyId>`, `prior_drug:<DrugClassId>`. BiomarkerIds gain `MET`, `RET`, `HPV`, `CLDN18`, `PH`, `NPM1`, `TP53`, `MGMT`, `PIK3CA`, `ESR1`, `PALB2`, `KIT`. The lite card tuple becomes `[key, value, param?]`.

---

## 2. Adaptive engine (`lib/questionnaire/engine.ts`, pure)

### 2.1 Phases
1. **Essentials, fixed order:** cancer_type, age, zip, travel. After cancer_type, `prefetchSearch` starts (already exists). After travel, `buildCandidatePool()` applies the hard filters over the loaded shard with **no embeddings** (group, age, distance, plus sex once answered) and computes a prior relevance with BM25 only over the current profile text. This takes milliseconds, and the counter appears.
2. **Adaptive:** choose `nextQuestion` repeatedly (§2.2) until a stop rule fires (§2.3). The patient can stop at any point ("Show my matches now").
3. **Summary card:** edit any answer, then search. The full `searchTrials` (embeddings + RRF) runs only here.

### 2.2 Selection: expected information gain over the current top candidates
- Candidate distribution: take the top K = 60 trials by current score (BM25 prior minus existing penalties), with p(t) ∝ exp(score_t / τ) and τ = 0.15.
- Likelihood of answer option a for trial t: L(t,a) = e^(−λ) if the rules give *conflict*, e^(+μ) if *support*, else 1. Use λ = 1.2 and μ = 0.4, mirroring the CONFLICT_PENALTY to SUPPORT_BONUS ratio.
- Posterior: p_a(t) ∝ p(t)·L(t,a). Gain: IG(q) = H(p) − Σ_a P(a)·H(p_a), where P(a) comes from the catalog priors for the group and **P(unknown) contributes zero gain** (its posterior equals the prior). Questions that patients often cannot answer are therefore naturally demoted.
- Utility: U(q) = IG(q) / cost(q) × tierFactor (essential ∞, helpful 1.0, deep 0.6 in quick mode and 1.0 in thorough mode).
- Eligible questions: enabled, appliesTo the group, prerequisites met, not yet answered, not deferred.
- Tie-break: catalog order. The function is deterministic, so tests are stable.
- Impact preview for the UI: for each option a, M_a = the number of pool trials with no conflict under a. The card shows "Answering this could narrow N trials to about M" with M = min over definite options of M_a, and nothing when M = N.

### 2.3 Stop rules
| Mode | Stop when any holds |
|---|---|
| quick (default) | max U < 0.05 bits; or 7 adaptive questions asked; or no-conflict count ≤ 12; or no eligible questions remain |
| thorough | max U < 0.01; or 20 adaptive questions; or no eligible questions remain |
"Thorough" can be switched on at any point ("Add more detail for better matches"). After stopping, the summary offers "Answer N more optional questions" when eligible Deep-dive questions remain.

### 2.4 Non-response (Addendum A)
- Every H and D question renders "Not sure", "Skip" and (for sensitive questions) "Prefer not to say". All three are stored as `UNKNOWN`, `__skip` or `PREFER_NOT` and have **identical matching semantics: no facts, no query terms, no hard filters**.
- Effect on candidates: none, so the counter does not drop and the set stays honestly wide. The message reads: "That's okay. We'll keep all N trials and note this as something to ask your care team."
- The engine moves on: an unknown answer marks the question answered, and **siblings whose prior P(unknown) ≥ 0.6 are downweighted** after two unknowns in a row of the same kind (e.g. two "don't know" biomarkers lower the remaining biomarker questions' U by 50%). The next question is one the patient is more likely to know (daily activity, treatments, spread).
- Unknowns feed the "Find out" list (§5.3).
- Invariant (tested, §7.1): for every trial, `score(answers with q = unknown) === score(answers without q)`, and the hard-filter set is identical. Unknown never lowers rank and never excludes.

### 2.5 State, back/edit, resume
```ts
export interface QuestionnaireState {
  v: 2; area: "cancer"; mode: "quick" | "thorough";
  answers: Partial<Record<QuestionId, AnswerValue>>;       // AnswerValue = string | string[] | number | Record<string,string> | null
  history: QuestionId[];                                    // order asked (for Back)
  deferred: QuestionId[];                                   // "my doctor can fill this in later"
  updatedAt: number;
}
```
- Back: pops the history, and the question re-renders with its answer. Editing an answer recomputes downstream prerequisites; dependent answers whose prerequisite no longer holds are dropped and the UI says so.
- Resume: the state is serialized to `sessionStorage["tb-questionnaire-v2"]` (tab-scoped, gone when the tab closes; never localStorage or IndexedDB, never server). It is validated with zod on load and discarded if invalid or older than 12 hours. There is a visible "Clear my answers" button. The privacy page copy that says answers "disappear when you close or refresh the tab" must change to "are kept only in this browser tab until you close it" in every locale. The service worker must not cache it (it does not touch storage).
- Deferred ("My doctor can fill this in later"): an option on cost-3 questions. It counts as unknown for matching, appears in the Find-out list, and stays one tap away under "Questions waiting for your doctor" in this session, so a patient can fill it in during or after an appointment in the same tab.

### 2.6 Live counter
`liveCount(state, pool) → { total, noConflict, supported }`. The UI shows "**N** possible trials near you · **M** with no likely conflicts". Hard filters change `total`; definite answers change `noConflict`. It updates in an `aria-live="polite"` region, debounced 500 ms, and announces only on change.

---

## 3. Matching integration

### 3.1 Precheck generalization
`lib/match/precheck.ts` becomes catalog-driven: `evaluateAnswers(state, catalog, facts) → PrecheckNote[]`. Existing behavior is a special case and is kept (the existing tests stay green). The rules:
- `value: "mentioned"`, `needsReview`, or facts whose key has `penalize: false` in `config/questionnaire/fact-policy.ts` → ignored (support allowed only if `supportOnly`).
- Param comparisons: trial `ecog_max = 1`, answer ECOG band "2" → conflict; band "0-1" → support. `brain_mets: excluded` with `param: "active_only"` → conflict only for "active". `min_prior_lines = 2` with answer 1 → conflict. `max_prior_lines = 1` with answer "3+" → conflict.
- Sex is a hard filter only when the answer is definite and `trial.sex ≠ ALL`. This goes in `filters.ts` as `passesSex`, the only new hard filter.

### 3.2 Score (named weights, `lib/match/score.ts`)
```
final = RETRIEVAL_WEIGHT·retrieval − Σ_conflicts min-capped (CONFLICT_PENALTY · FACT_WEIGHT[key] · RELIABILITY[source])
        + SUPPORT_BONUS·min(supports, 3) + BIOMARKER_MATCH_BONUS·[required biomarker matched] + PHASE_PREF_BONUS + FIT_ADJUSTMENT[fit]
```
| Weight | Value | Reason |
|---|---|---|
| RETRIEVAL_WEIGHT | 1.0 | unchanged |
| CONFLICT_PENALTY | 0.15 | unchanged; MAX_COUNTED_CONFLICTS 3 → **4** (more questions mean more legitimate signals; still capped) |
| FACT_WEIGHT | 1.0 default; 0.5 for `other_malignancy`, `organ disease` keys, `measurable_disease` (high carve-out rate); 1.2 for `histology:*`, `biomarker:*` required | subtype and biomarker requirements are the most specific gates |
| RELIABILITY | rule 1.0; llm = confidence; key families below the precision gate have penalize=false | 66% historical precision |
| SUPPORT_BONUS | 0.03 | unchanged |
| BIOMARKER_MATCH_BONUS | 0.08, once | a required marker the patient has is strong positive evidence |
| PHASE_PREF_BONUS | ±0.03 | preference, never a filter |
| FIT_ADJUSTMENT | unchanged | |
Never exclude on facts. Hard filters remain: group, age, distance, and a definite sex.

### 3.3 Profile text (`lib/match/query.ts`)
`buildProfileText` concatenates `queryTerms` from the chosen options in catalog order (English, from config), e.g. "Non-small cell lung adenocarcinoma. EGFR positive. Previously treated with osimertinib." Unknown adds nothing. The BM25 index and embeddings are unchanged, and there is no re-ingestion of embeddings.

### 3.4 Adapter
`toIntakeAnswers(state): IntakeAnswers` keeps `searchTrials`, `requestAnalysis` and existing tests working. `IntakeAnswersSchema` gains optional fields (`questionnaire?: QuestionnaireState`) and `searchTrials` passes the state to `evaluateAnswers`.

---

## 4. Data minimization (any change needs a privacy test)

### 4.1 Principle
Only **coarse disease-describing categories** may go to AI providers. **Change in v7:** coarse health-history categories (sex in records, measurable disease, other cancer, HIV, hepatitis, transplant, autoimmune, organ problems) may also be sent, as the option id the user picked, so the criterion judge can check exclusion rules (`sexListed`, `measurableDisease`, `otherCancer`, `hivStatus`, `hepatitisStatus`, `transplantType`, `autoimmuneStatus`, `organProblems` in `MinimizedProfileSchema`). Not sure, prefer-not and deferred answers are never sent. Pregnancy details beyond the existing enum, exact age, ZIP, travel, phase preference and the deferred list **stay in the browser**. There is still no free text (the questionnaire has none).

### 4.2 Updated schema (`lib/types/analysis.ts`)
```ts
export const MinimizedProfileSchema = z.strictObject({
  v: z.literal(2).optional(),                                   // absent = v1 payload (still accepted)
  cancerType: CancerGroupIdSchema,
  ageBracket: AgeBracketSchema,
  spread: SpreadSchema,                                         // unchanged: yes | no | not_sure
  treatments: z.array(TreatmentSchema).min(1).max(9),           // adds hormone_therapy, stem_cell_transplant
  biomarkers: z.partialRecord(BiomarkerIdSchema, BiomarkerStatusSchema),  // extended ids; "not_tested" maps to dont_know
  pregnant: PregnancySchema,
  concurrentTrial: YesNoUnknownSchema,                          // adds not_sure
  language: AiLanguageSchema,                                   // §6.6 allowlist enum (BCP-47)
  // v2 coarse fields, all optional, every enum includes "not_sure"
  subtype: z.enum(SUBTYPE_IDS).optional(),                      // closed list from config, e.g. "nsclc_adeno"
  stageCategory: z.enum(["early", "locally_advanced", "metastatic", "no_evidence_after_surgery", "not_sure"]).optional(),
  diseaseStatus: z.enum(["new", "recurrent_or_progressing", "on_treatment", "not_sure"]).optional(),
  priorLines: z.enum(["0", "1", "2", "3+", "not_sure"]).optional(),
  activityBand: z.enum(["0-1", "2", "3-4", "not_sure"]).optional(),
  brainMets: z.enum(["none", "treated_stable", "active", "not_sure"]).optional(),
  groupStatus: z.enum(GROUP_STATUS_IDS).optional(),             // e.g. "crpc", "platinum_resistant"
  priorDrugClasses: z.array(z.enum(DRUG_CLASS_IDS)).max(12).optional(),
});
```
- `minimizeProfile(state)` copies fields explicitly (never spreads) and maps `prefer_not`, `__skip` and deferred answers to `not_sure` or omission.
- The server (`functions/lib/analyze.ts`) validates the same schema and has the request size limit (16 KB) unchanged.
- The analysis cache key includes the whole minimized profile, so v2 fields lower cache hit rates. To keep them useful, `priorDrugClasses` is sorted and omitted when empty.
- Prompt `prompts/analyze-v2.ts` renders the fields as fixed English labels from a server-side map (never echoes enum ids raw beyond the closed set).

### 4.3 Stays in the browser (never in any request)
ZIP, travel, exact age, phase preference, deferred list, Find-out list, session state, the raw questionnaire answers, and any not-sure / prefer-not / deferred health-history answer. The e2e network test asserts none of these keys appears in any `/api/*` body and that the profile only carries allowed keys.

---

## 5. UX

### 5.1 Flow and look
- The chat look is kept (bubbles, quick-reply chips), one question per screen on phones. Each question card has the question (≤ 15 words), a one-line plain help, a collapsible **"Why we're asking"** (`whyKey`, ends with the evidence in plain words, e.g. "About half of nearby lung studies have rules about this"), the options, then "Not sure" / "Skip" chips styled equally (not as secondary links), and Back.
- Header: progress shows the tier as "Essentials · Helpful · Extra detail" with a step dot bar and an estimate ("about 4 more questions") rather than a fake percentage, plus the live counter (§2.6).
- Tiers are visible: after the Essentials: "You can see matches now, or answer a few more questions to sharpen them." Deep-dive questions are labelled "Optional: more detail can mean better matches."
- Quick and thorough mode: a segmented control on the first adaptive screen, changeable at any time.
- Wording: reading grade 6-8 (Flesch-Kincaid check in tests for `en`). "Possible match to discuss with your care team." The words "eligible", "qualify", "you can join" are banned in all locales (lint test, §7.6).
- Under 18: the existing respectful pediatric message with ClinicalTrials.gov and pediatric resources stays unchanged and stops the flow. Crisis: the intake has no free text, so there is no detection there. The Q&A crisis line and the always-visible resource line (§6.7) stay.
- Mobile-first: 44 px targets, sticky bottom action bar (Back / Skip / Continue), no horizontal scroll, works at 320 px.

### 5.2 Accessibility
- Each question is a `fieldset` with a `legend`. Single choice is a radio group with arrow-key navigation; multi choice uses checkboxes; the biomarker grid is a table of radio groups with row headers.
- Focus moves to the new question legend after Continue (existing `FocusOnMount`), and back to the edited field on Back.
- Live regions: the chat log is `role="log"` (existing). The counter is a separate `aria-live="polite"` `aria-atomic="true"` element. Errors use `aria-describedby`.
- Respects reduced motion. Contrast meets WCAG AA. No color-only state. axe has no serious or critical violations in all locales, including RTL.

### 5.3 "Find out at your next appointment" list (Addendum A)
- Built by `findOutList(state, catalog, group)`: one item per question answered unknown, skipped or deferred that has a `findOutKey`, ordered by the question's IG at the time it was asked, so the most useful item comes first.
- Each item has: what to ask ("Ask: 'What are my tumor's biomarker results, like EGFR or ALK?'"), where to find it ("Look in your **pathology report** or **genomic/biomarker test report**, often in your patient portal under Test Results or Documents"), and why ("About 3 in 10 nearby lung studies depend on this").
- Catalog of `find-out.ts` entries: biomarker results (pathology/molecular report), stage (pathology or imaging report, "staging" in the oncologist's notes), subtype/histology (pathology report "Final diagnosis"), lines of therapy (medication list, infusion history), performance status (ask the oncologist), brain scan results (MRI report), platinum timing (treatment dates), castration status (PSA and testosterone trend), HPV/p16 (pathology report).
- Shown on the summary card and the results page, and included in the print/save view ("Bring this to your appointment") as a checklist with tick boxes. It is never sent anywhere.
- After the appointment, in the same tab, "Fill in what you found out" reopens exactly those questions.

---

## 6. Languages and i18n platform

### 6.1 Source of truth and keys
- `components/i18n/en.ts` stays the **typed English source**: nested `as const` object. Key paths are locale-agnostic (`questionnaire.daily_activity.label`), and `type MessageKey` is derived by a template-literal path type. Catalog keys (`labelKey` etc.) are typed as `MessageKey`, so a missing English key is a compile error.
- Other locales become **JSON** files: `public/i18n/<tag>.json` (flat `{ "a.b.c": "…" }`) plus `public/i18n/manifest.json` (generated). The existing `es.ts`, `pt.ts` and `ht.ts` are converted once by a script, and the TS files are deleted.
- `config/locales.ts` (registry, data only):
```ts
export interface LocaleDef { tag: string; nativeName: string; englishName: string; dir: "ltr" | "rtl";
  script: "Latn" | "Hans" | "Hant" | "Arab" | "Hebr" | "Deva" | "Beng" | "Gujr" | "Hang" | "Cyrl" | "Viet";
  fontPack?: FontPackId; aiSupported: boolean; crisisLexicon: boolean; plural?: never /* Intl.PluralRules handles it */ }
```
  Manifest entries add `{ status: "reviewed" | "machine" | "partial", coverage: number, sourceHash: string, updated: string }`.
- Adding a language = one `LOCALES` entry + `npm run i18n:translate -- <tag>` + (optional) a crisis lexicon file + (optional) a font pack. **No component code changes.**

### 6.2 Runtime (`components/i18n/index.ts`, rewritten)
- `t(key, vars?)` with `{name}` placeholders. Plurals use keys `x.one / x.other / x.few…` selected by `Intl.PluralRules(tag)`. Numbers and dates use `Intl.NumberFormat` and `Intl.DateTimeFormat` (counter, distances, data date). There is no new dependency (no ICU library).
- Loading: `fetch("/i18n/<tag>.json")` on demand (same-origin, so CSP `connect-src 'self'` already covers it), cached in memory. English is bundled.
- **Per-key English fallback.** If any key is missing, the page shows "Partially translated. Some text is in English." once (dismissible). The note shows at `coverage < 100%` or `status ≠ reviewed` ("Machine-translated, not reviewed by native speakers"), replacing today's fixed note.
- `document.documentElement.lang = tag` and `dir = def.dir`. Choice stored in `localStorage["tb-lang"]` (existing). `navigator.languages` is used **only to suggest** ("Ver en español?" banner). There is no auto-switch and nothing is sent server-side.

### 6.3 RTL
- Convert directional Tailwind utilities to logical ones (`ms-/me-/ps-/pe-/start-/end-/text-start`). An ESLint rule (no-restricted-syntax on class strings matching `\b(ml|mr|pl|pr|left|right|text-left|text-right)-`) prevents regressions.
- Icons with direction (chevrons, arrows) get `rtl:-scale-x-100`. Charts and the U.S. tile map stay LTR inside `dir="ltr"` containers. Official English trial text renders in `<span dir="ltr" lang="en">`.

### 6.4 Fonts
- Font stack per script: Inter or Fraunces, then the system fonts for that script (PingFang SC, Microsoft YaHei, Noto Sans CJK, Segoe UI, Geeza Pro…), then a self-hosted **Noto** pack. Because system fonts come first, most phones download nothing.
- Packs are `public/fonts/noto/<pack>/` woff2 slices with `unicode-range` (CJK split into ~100 slices so only used glyphs load). A stylesheet `/fonts/noto/<pack>.css` (same-origin, CSP-safe) is injected only when that language is chosen.
- Budget: Latin/Cyrillic/Vietnamese extensions are covered by Inter (no pack). Arabic, Devanagari, Bengali and Gujarati: one variable woff2 each, ≤ 200 KB. CJK: slices of ≤ 60 KB each, with a typical page under 600 KB. All files are below the 25 MiB per-asset limit and cached immutably. Fonts are fetched by `scripts/fetch-fonts.ts` (OFL license recorded in `public/fonts/noto/LICENSE`).

### 6.5 Picker
A searchable combobox (ARIA 1.2 pattern) listing the native name first and the English name second (e.g. "Tiếng Việt · Vietnamese"), matching on both, with a status badge (Reviewed / Machine-translated). It is in the header and on the first questionnaire screen.

### 6.6 AI language
- `AiLanguageSchema = z.enum(AI_LANGUAGE_TAGS)` generated from `LOCALES.filter(l => l.aiSupported)` (en, es, pt, ht plus §6.9). It replaces `LanguageSchema` at the API boundary for `/api/analyze` and `/api/ask`.
- The prompt receives `englishName` from a **server-side map keyed by the validated tag**, never raw user text. `experimental = manifest status ≠ "reviewed"`, which replaces today's `language === "ht"` check. Quotes stay in English. `NEUTRAL_NOTE` and the server-written refusal and crisis texts gain entries per AI language, falling back to English plus a localized-language notice.

### 6.7 Safety per locale
- An **always-visible resource line on every Q&A panel and results page in every locale**: "If you are in crisis, call or text 988 (Suicide & Crisis Lifeline). In an emergency, call 911." It is translated, and the English is shown too for machine-translated locales. Claims about 988 interpreter availability must be verified before being added to copy.
- Lexicons: `functions/lib/safety/lexicons/<tag>.ts` (server) and the same data shared to the client pre-check (BUGS M1 fix) via `lib/safety/lexicons/`. A lexicon may only be marked `crisisLexicon: true` after a native or professional review; machine-made lexicons are not trusted.
- Conservative fallback for locales without a reviewed lexicon: (a) run all available lexicons (en, es, pt, ht + reviewed) on the normalized text; (b) show the crisis box when **any** pattern matches, including English words embedded in other text; (c) the always-visible line guarantees resources even on a miss. The Q&A UI states in that locale: "For urgent help, use the numbers above."

### 6.8 Translation workflow: `npm run i18n:translate -- <tag> [--provider=local|groq|cerebras|openrouter] [--all-missing]`
- `scripts/i18n/translate.ts`: diff the English keys against `<tag>.json` plus stale keys (manifest stores a per-key hash of the English source), batch 40 keys, and call the local **llama-server** (`http://127.0.0.1:8080/v1`, Qwen3-14B, thinking off, temperature 0.2, JSON schema output) or a configured free provider only when `dataTermsVerified` (UI strings contain no user data).
- The system prompt includes the per-locale glossary `i18n/glossary/<tag>.json` (e.g. "possible match to discuss with your care team", "clinical trial", "care team") and the banned-word list.
- Validation per key: JSON parses; placeholder sets equal; plural forms required by `Intl.PluralRules(tag).resolvedOptions().pluralCategories` present; length ratio 0.3-2.5 vs English (Latin) or 0.2-1.8 (CJK); no HTML or markdown; not identical to English unless allowlisted (brand, "ZIP"); banned-claim patterns absent. Failed keys are retried once and are otherwise left missing (they fall back to English).
- Writes `<tag>.json` and updates `manifest.json` (`status: "machine"`, coverage). It never overwrites keys marked `reviewed` in `i18n/reviewed/<tag>.keys.json`.

### 6.9 Languages to ship ready (machine-translated, clearly labelled)
Proposed: **zh-Hans, zh-Hant, vi, ko, tl, ar, ru, fr, hi, pl, bn, gu**, plus ur and fa as RTL coverage if capacity allows. Reasoning (to be verified against current ACS "language spoken at home" tables before launch; no figures are asserted here): Chinese, Vietnamese, Tagalog, Korean, Arabic, Russian and French are consistently among the largest non-English, non-Spanish home languages in U.S. Census releases, and are the languages health systems most often include in HHS Section 1557 tagline lists. Hindi, Bengali and Gujarati cover large South Asian communities around major cancer centers (NY, NJ, TX, IL). Polish covers the Midwest and Northeast. Arabic, Urdu and Persian exercise the RTL path. Haitian Creole and Portuguese are already shipped. All new locales ship `status: "machine"`, AI output is `experimental`, and there is a native-review checklist in WP4.

---

## 7. Test plan 

### 7.1 Engine and mapping (Vitest, pure)
- Catalog schema: every non-essential question has unknown and skip; sensitive questions have prefer_not; unknown options carry no effects; keys exist in `en`; prerequisites are acyclic; `enabled` questions have ≥ 1 backing fact key present in data (checked against the seed).
- `nextQuestion`: essentials always come first and in order; ineligible or prerequisite-failing questions are never chosen; it is deterministic; IG is 0 when no candidate has the fact; P(unknown)=1 gives zero gain; the stop rules fire at each threshold; quick asks ≤ 7 adaptive questions.
- **Non-response invariants (property tests with a seeded PRNG, 1,000 random states × seed shard):** for each question q and each trial, (a) hard-filter set(unknown q) = set(no q); (b) final score is equal; (c) rank is equal; (d) the counter `total` and `noConflict` are equal; (e) prefer_not and skip behave the same as unknown; (f) the deferred list does not change scores.
- `evaluateAnswers`: one table-driven case per FactRule (ECOG thresholds, brain-mets carve-out, line min/max, histology, prior_drug, sex hard filter). The existing precheck tests stay unchanged and green.
- `minimizeProfile` v2: rejects extra fields; never contains sensitive keys (enumerated test over the §4.3 list); maps prefer_not to not_sure; v1 payloads still parse.
- `findOutList`: ordering, dedupe, only unknown, skipped or deferred items.

### 7.2 Simulated patients (adaptive vs fixed)
- `scripts/eval/simulate.ts`: 400 synthetic patients across 12 groups. Hidden "true" attributes are sampled from catalog priors. Each patient answers "don't know" with per-question probability (biomarkers 0.4, ECOG 0.2, lines 0.25, subtype 0.3, others 0.1).
- Oracle = ranking with all true attributes. Compare the **fixed flow** (catalog order truncated at k) with the **adaptive** flow at k = 3…12 questions, using nDCG@10 against the oracle top 10 and the share of top 10 with oracle conflicts.
- Acceptance: adaptive reaches ≥ 95% of the fixed flow's full-length nDCG using ≤ 60% of its questions on average, and beats fixed at every k ≤ 7. Median quick-mode length is ≤ 7 adaptive questions. Results go to `eval/RESULTS.md`.

### 7.3 Retrieval quality (eval/labels)
- Extend `eval/labels.json` to schema v2: add `state` (QuestionnaireState) to each of the 30 profiles, with realistic unknowns, and add 10 profiles (myeloma, thyroid, liver/biliary, gastroesophageal HER2+, SCLC, EGFR+ NSCLC with brain mets, CRPC, platinum-resistant ovarian, AML FLT3+, ECOG 2).
- `make-labels.ts` rules add the new attributes (e.g. ALK-required trials are excluded for an EGFR+ patient; SCLC-only trials are excluded for NSCLC). They are synthetic.
- **Gates:** (1) non-regression: nDCG@10 on the v1 labels with legacy answers is ≥ **0.800** (the current full pipeline, seed); (2) the v2 full pipeline is ≥ v1 on the v2 labels and should improve; (3) hard-filter violations stay at 0%; (4) the excluded-label share of the top 10 must not rise above 0.271.
- Run on the seed in CI and on national data locally (documented). Fact precision: a 50-item labeled sample **per new key family**; a family gets `penalize: true` only at ≥ 85% precision, otherwise support-only or off.

### 7.4 E2E (Playwright, desktop + mobile)
- One flow per type: breast HER2+, lung EGFR+ with brain mets, prostate CRPC, colorectal MSI-H, leukemia AML, lymphoma DLBCL post-CAR-T, melanoma adjuvant, "Other / not sure".
- All-unknown flow: the counter never drops after the essentials, results appear, and the Find-out list is in the print view.
- Back and edit, including prerequisite invalidation; reload resumes from sessionStorage; "Clear my answers" clears it; closing the tab and opening a new one starts fresh.
- Under-18 stop; quick and thorough toggle.
- Network test extended: none of the §4.3 values appear in any request.

### 7.5 Accessibility
axe (no serious or critical issues) on every question type in en, ar (RTL) and zh-Hans; keyboard-only completion of the full flow; screen-reader live-region announcements asserted via text in the counter region; 200% zoom and 320 px viewport have no horizontal scroll.

### 7.6 i18n
- Key parity: each locale JSON's keys ⊆ en keys (no orphans); coverage is reported.
- Placeholders: identical sets per key; plural categories complete per `Intl.PluralRules`.
- Banned words per locale ("eligible/qualify" equivalents from glossary files) are absent.
- `dir` and `lang` are set on switch; the fallback note appears when coverage < 100%.
- Lexicon tests: per reviewed locale, ≥ 15 positive and 15 negative phrases. The fallback test checks that an unsupported locale with an English crisis phrase still triggers the crisis box, and that the resource line is present on Q&A in every locale.
- The translate script is unit-tested with a mocked endpoint (validation rejects broken placeholders, HTML and length outliers).

---

## 8. Interface contracts

```ts
// C1 : config/questionnaire/index.ts
export function getCatalog(area: "cancer", group: CancerGroupId): readonly QuestionDef[];
export function getFindOutItems(): Readonly<Record<QuestionId, FindOutDef>>; // { whatKey, whereKey, whyKey }
export const FACT_POLICY: Readonly<Record<string, { penalize: boolean; weight: number; supportOnly?: boolean }>>;

// C2: lib/types/trial.ts additions (§1.4); HistologyId, DrugClassId, SubtypeId enums live in
// config/questionnaire/ids.ts and are imported by the schemas.

// C3: lib/questionnaire/engine.ts
export interface CandidatePool { group: CancerGroupId; trials: ReadonlyArray<{ id: string; prior: number; facts: readonly CompactFact[]; sex: "ALL"|"FEMALE"|"MALE" }> }
export function buildCandidatePool(state: QuestionnaireState, opts?: { signal?: AbortSignal }): Promise<CandidatePool>; // hard filters + BM25 prior, no embeddings
export type NextStep =
  | { kind: "ask"; question: QuestionDef; utility: number; impact: { total: number; narrowedTo: number | null } }
  | { kind: "done"; reason: "small_set" | "low_gain" | "max_questions" | "exhausted" };
export function nextQuestion(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]): NextStep;
export function applyAnswer(state: QuestionnaireState, q: QuestionId, value: AnswerValue, catalog: readonly QuestionDef[]): { state: QuestionnaireState; dropped: QuestionId[] };
export function liveCount(state: QuestionnaireState, pool: CandidatePool, catalog: readonly QuestionDef[]): { total: number; noConflict: number; supported: number };
export function findOutList(state: QuestionnaireState, catalog: readonly QuestionDef[]): FindOutEntry[]; // { question, whatKey, whereKey, whyKey, deferred }
export function saveSession(state: QuestionnaireState): void; export function loadSession(): QuestionnaireState | null; export function clearSession(): void;

// C4: lib/match
export function evaluateAnswers(state: QuestionnaireState, catalog: readonly QuestionDef[], facts: readonly Fact[]): PrecheckNote[];
export function searchTrials(answers: IntakeAnswers /* with questionnaire */, opts?: SearchOptions): Promise<SearchOutcome>; // signature unchanged
export function minimizeProfile(answers: IntakeAnswers): MinimizedProfile; // v2 fields when questionnaire present

// C5: components/i18n, config/locales.ts
export function useT(): { t: (key: MessageKey, vars?: Record<string, string | number>) => string; lang: string; dir: "ltr"|"rtl"; status: LocaleStatus; formatNumber(n: number): string; formatDate(d: Date): string };
export const LOCALES: readonly LocaleDef[]; export const AI_LANGUAGE_TAGS: readonly [string, ...string[]];
export function CrisisLine(): JSX.Element;
```

---

## 9. Risks and deferred

### 9.1 Risks
| Risk | Mitigation |
|---|---|
| New fact extraction is imprecise (historical 66%), so new penalties hurt real fits | per-family precision gate (≥ 85%) before `penalize: true`; support-only otherwise; `mentioned` for lists and "or" clauses; LLM layer marks disagreements needsReview |
| A mention rate overstates gating (the regex counts any mention) | IG uses directional facts only, so questions with weak facts self-demote; re-measure after the fact extraction changes |
| Patients can't answer clinical questions (ECOG, lines, platinum timing) | plain-language options, cost weighting, P(unknown) priors, Find-out list; unknown is never penalized |
| Sensitive questions (HIV, hepatitis) deter or upset users | Deep-dive only, prefer-not option, inline note on how the answer is used; v7: definite answers go to the AI judge as categories (prefer-not never) |
| sessionStorage resume changes the privacy promise | copy update in all locales, Clear button, tab scope, zod validation, 12 h expiry |
| More AI fields lower the cache hit rate and raise token use | coarse enums only, sorted arrays, optional fields omitted when unknown; monitor via eval:live later |
| Lite "not sure" shard grows with more fact tuples | estimate +6 tuples/trial × 5.7k ≈ +0.5 MB raw; drop the low-value keys (organ, phase) from the lite card if gzip grows > 15% |
| The sex hard filter wrongly excludes (e.g. a transgender patient) | definite answer only; "prefer not" = no filter; help text says "sex listed in medical records, used only because some studies list it"; the summary shows "Studies for women only were hidden. Change" |
| Machine translations of medical terms are wrong or unsafe | glossary, banned-claim tests, "machine-translated" badge, English safety line always shown; native review before `reviewed` |
| Crisis detection misses in unreviewed locales | always-visible 988/911 line, union of lexicons, client-side pre-check |
| RTL and CJK layout regressions | logical-property lint rule, axe and visual checks for ar and zh-Hans in e2e |
| Font weight on slow phones | system fonts first, unicode-range slices, loaded only for the chosen locale |
| The IG engine's behavior is opaque to judges | deterministic, named constants (λ, μ, τ, K, thresholds) in `lib/questionnaire/constants.ts` with comments; "Why we're asking" text shows the evidence |

### 9.2 Deferred
Non-cancer catalogs (the interface exists: `area`); cross-session resume via a local encrypted export/import file; lab-value questions (creatinine, LVEF); trial-specific "follow-up questions" after results (re-ranking on demand); clinician-reviewed labels and real-user evaluation; native-speaker review of the 12 new locales and their crisis lexicons; full national LLM fact extraction (≈20 h); smart subtype detection from pathology text (would need free text: out of scope by privacy rule); Haitian Creole and new-locale voice/audio support.
