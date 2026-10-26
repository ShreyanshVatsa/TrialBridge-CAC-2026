/**
 * Rule-layer eligibility patterns (always runs on every trial). Applied by lib/ingest/facts.ts.
 * Patterns are deliberately conservative: when direction is unclear the fact is "mentioned",
 * which never penalizes a patient.
 */
import type { CancerGroupId } from "./cancer-groups";
import type { DrugClassId, HistologyId } from "./questionnaire/ids";


/** Prior-treatment facts: a pattern that identifies the therapy type in a criterion. */
export const THERAPY_PATTERNS = {
  prior_chemotherapy: /\bchemo(therap(y|ies)|immunotherapy)?\b|\bcytotoxic\b/i,
  prior_radiation: /\b(radiation|radiotherapy|radiosurgery|SBRT|SRS|irradiation)\b/i,
  prior_surgery: /\b(surgery|surgical|resection|resected|mastectomy|lumpectomy|prostatectomy)\b/i,
  prior_immunotherapy: /\b(immunotherap(y|ies)|immune checkpoint|checkpoint inhibitor|anti-?PD-?L?1|anti-?CTLA-?4|CAR[- ]?T)\b/i,
  prior_targeted_therapy: /\b(targeted therap(y|ies)|tyrosine kinase inhibitor|TKIs?|PARP inhibitor|CDK ?4\/6 inhibitor|kinase inhibitor)\b/i,
} as const;

/** The criterion is about treatment history (not, e.g., a planned study procedure). */
export const PRIOR_CONTEXT = /\b(prior|previous(ly)?|preceding|received|receiving|treated with|history of|exposure to|naive|na[iï]ve|any line|lines? of|refractory|progress(ed|ion)|after|following)\b/i;
/** Negations inside an inclusion criterion ("no prior chemotherapy") flip it to excluded. */
export const NEGATION = /\b(no|not|never|without|must not|cannot|none)\b/i;
/** "Prior X is allowed" does not make X required or excluded -> mentioned. */
export const ALLOWED = /\b(allowed|permitted|acceptable|(may|could|can) have (previously )?(had|received)|(may|can) (still )?(receive|have)|is not required|are eligible|not (be )?eligible|ineligible|not (a )?candidates?|intolerant|recovered from|toxicit(y|ies)|adverse events?|side effects?)\b/i;
/** Washout windows ("within 4 weeks") are timing rules, not "never treated" rules -> mentioned. */
export const WASHOUT = /\bwithin\s+(\d+|one|two|three|four|six)\b|\bwash-?out\b|\b\d+\s*(days?|weeks?|months?|half-lives)\s+(prior|before|of)\b|\blast dose\b|\bwash(ed)?[- ]?out\b/i;

export const METASTATIC = /\b(metasta(tic|sis|ses|sized)|stage\s*(iv|4)\b|distant (disease|spread))/i;
export const LOCAL_METASTASES_ONLY = /\b(brain|cns|central nervous system|leptomeningeal|spinal cord|bone)\s+metasta|\bmetasta\w*\s+(to|in|of)\s+(the\s+)?(brain|cns|central nervous system|bones?|spine|spinal cord|leptomeninges)/i;
export const NON_METASTATIC = /\bnon-?metastatic\b|\bno (evidence of )?(distant )?metasta|\bwithout (distant )?metasta|\bm0\b|\bnegative for (?:any )?(?:distant )?metasta/i;

export const NEWLY_DIAGNOSED = /\b(newly diagnosed|treatment[- ]na[iï]ve|previously untreated|untreated|no prior (systemic )?(therapy|treatment|anti-?cancer))\b/i;
/** Bare "recurrent" is not here: a recurrence says nothing about systemic treatment (labeled errors). */
export const PREVIOUSLY_TREATED = /\b(relapsed|refractory|progress(ed|ion) (on|after|following|during)|previously treated|at least (one|1|two|2|three|3) (prior )?(line|regimen|therap))/i;

/**
 * A therapy word that is not about the patient's treatment history (labeled errors, eval/facts-labels.json):
 * a tissue source ("tissue from prior surgery"), a planned procedure ("planned surgical resection"), an
 * organization ("Radiation Oncology Core"), or reproductive status ("surgical sterilization", "menopause by radiation").
 */
export const THERAPY_SPECIMEN_LEAD = /\b(?:tissue|specimens?|samples?|blocks?|slides?|material)\b[^.;]{0,40}$/i;
export const THERAPY_SPECIMEN_AFTER = /^\s*(?:\w+\s+){0,2}(?:specimens?|samples?|tissue|blocks?)\b/i;
export const THERAPY_PLANNED_LEAD = /\b(?:planned|scheduled|candidates? for|eligible for|indicated for|amenable to|suitable for|will undergo|undergo(?:ing)?|plans? to|intends? to|referred for|considered for|standard of care)\b[^.;]{0,30}$/i;
export const THERAPY_NOT_HISTORY = /\bradiation oncology\b|\bsteriliz\w*|\btubal ligation\b|\bhysterectomy\b|\boophorectomy\b|\bmenopaus\w*/i;

export const PREGNANCY = /\b(pregnan(t|cy)|breast[- ]?feeding|lactating|nursing)\b/i;

export const CONCURRENT_TRIAL =
  /\b(another|other|concurrent|simultaneous|concomitant)\b[^.;]{0,50}\b(investigational|clinical (trial|study)|interventional (trial|study)|therapeutic (trial|study))|\bparticipat(e|es|ing|ion) in (another|other|any other)\b[^.;]{0,40}\b(study|trial)/i;

/** Biomarker direction words. */
export const POSITIVE_WORDS = /\b(positive|positivity|mutat(ion|ed|ions)|mutant|amplif(ied|ication)|overexpress(ion|ing)?|fusion|rearrange(d|ment)|high|deficient|altered|alterations?|variants?|fusions|rearrangements|expressing|methylated)\b|\+/i;
export const NEGATIVE_WORDS = /\b(negative|wild[- ]?type|absence|non-?(mutated|amplified)|not (mutated|amplified)|low|proficient|unmethylated)\b|-negative|\bwt\b/i;

/** Triple-negative breast cancer (ER-, PR-, HER2-). */
export const TRIPLE_NEGATIVE = /\btriple[- ]negative\b|\bTNBC\b/i;

/** Words that offer an alternative next to a fact ("A or B", "A/B", "A to B"): the fact is then one option, not a requirement. */
export const ALTERNATIVE_NEAR = /\b(or|and\/or)\b|\//i;
/** Same, without the slash ("HR+/HER2-" lists two markers, it does not offer a choice). */
export const OR_NEAR = /\b(or|and\/or)\b/i;
/** Other stages mentioned with metastatic/stage IV ("Stage III or IV", "stages I-IV") => metastatic is not required. */
export const OTHER_STAGES = /\bstages?\s*(i{1,3}|[123])[a-c]?\b/i;
/** A criterion about a different (other/second/prior) malignancy, not the study disease. */
export const OTHER_MALIGNANCY = /\b(other|another|second|additional|prior|previous|history of|concurrent)\b[^.;]{0,40}\b(malignan|cancer|neoplasm|carcinoma|tumou?r)/i;
/** Examples/parentheticals ("e.g., prior surgery") name a cause, not the criterion's own requirement. */
export const EXAMPLE_CONTEXT = /\b(e\.g|i\.e|such as|for example|for instance|including|due to|secondary to|resulting from)\b/i;
/** "unless adequately treated", "other than", "except" turn a rule into a conditional. */
export const UNLESS = /\b(unless|other than|except|excluding)\b/i;
/** The criterion lists several tumor types ("one of the following cancers", "tumor types"). */
export const LIST_CONTEXT = /\bone of the following\b|\bfollowing (cancers?|tumou?rs?|tumou?r types?|diseases?|histolog\w*|types?)\b|\btumou?r types?\b|\bcancer types\b/i;

// ---------------------------------------------------------------------------------------------
// Catalog fact families (QUESTIONNAIRE_SPEC §1.4). Applied by lib/ingest/eligibility-facts.ts.
// Same philosophy: a directional fact only when the reading is clear; otherwise "mentioned".
// ---------------------------------------------------------------------------------------------

/** Number words used in eligibility text. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, first: 1, second: 2, third: 3, fourth: 4, single: 1 };
/** A number token: digits, a number word, or "1st/2nd/3rd". */
export const NUM = String.raw`(\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|single)`;

/** Criterion applies only to one cohort/part/arm ("Part 2:", "Cohort B -", "Dose expansion:"). */
export const COHORT_PREFIX = /^\s*(\(?[a-z0-9ivx]{1,3}[.)]\s*)?[*•-]?\s*(\(?\b(part|cohort|arm|group|phase|stage|step|escalation|expansion|dose[- ](escalation|expansion)|module|substudy|sub-study|segment|stratum|consolidation|induction|maintenance)\b[^:]{0,60}[:)]|for (part|cohort|arm|phase)\b|in (part|cohort|arm)\b)/i;

/** Performance status mentions. */
export const ECOG_MENTION = /\b(ECOG|Eastern Cooperative (Oncology )?Group|Zubrod|WHO performance status|WHO PS)\b/i;
export const KPS_MENTION = /\b(Karnofsky|KPS|Lansky)\b/i;
export const PERFORMANCE_MENTION = /\b(ECOG|Eastern Cooperative|Zubrod|Karnofsky|KPS|Lansky|performance status|performance score|\bPS\b)/i;

/** Brain / CNS metastases. Leptomeningeal-only text is a different condition and is not used. */
export const BRAIN_METS = /\b(brain|cns|central nervous system|intracranial|cerebral|parenchymal (brain|cns))\s+(metasta\w*|mets|lesions? from|disease from|involvement by (solid|the) tumou?r)|\bmetasta\w*\s+(to|in|of|involving)\s+(the\s+)?(brain|cns|central nervous system)\b|\bbrain mets\b|\bBM\b(?=s?\b)/i;
/** Qualifiers that limit a brain-mets exclusion to active disease, or carve out treated/stable disease. */
export const BRAIN_ACTIVE = /\b(active|untreated|symptomatic|progressive|progressing|unstable|uncontrolled|not (been )?(adequately )?(treated|controlled)|requiring (immediate |ongoing |urgent )?(steroids|corticosteroids|treatment|therapy|intervention)|require (steroids|corticosteroids|treatment)|new or (progressive|enlarging)|growing)\b/i;
export const BRAIN_CARVEOUT = /\b(unless|except|provided|if they|if the|eligible|allowed|permitted|may (participate|enroll|be (included|enrolled|eligible))|can (participate|enroll)|are acceptable|stable|previously treated|treated and)\b/i;
/** Inclusion wording that makes brain metastases the trial's subject (radiosurgery, CNS-penetrant drugs). */
export const BRAIN_REQUIRED = /\b(must have|presence of|diagnosis of|diagnosed with|at least (one|1)|confirmed|evidence of|newly diagnosed|new or recurrent|radiographic(ally)?|lesions?\b|\d+\s*(-|to)\s*\d+\s*brain)/i;

/** Measurable disease (RECIST, RANO, Lugano, IMWG, PCWG). */
export const MEASURABLE = /\bmeasurable\b/i;
export const MEASURABLE_OPTIONAL = /\b(evaluable|non-?measurable|not (be )?required|or assessable|and\/or|may have|either|unmeasurable|or bone[- ]only|bone[- ]only|(does|do|need) not (have to |need to )?be|need not|not necessary|regardless)\b/i;
/** Definitions of what counts as measurable (target-lesion rules), not a requirement. */
export const MEASURABLE_DEFINITION = /\b((are|is|be|may be|will be) (considered|deemed|regarded as) measurable|measurable (lesions?|disease) (that|which|located|situated|in a previously)|(lesions?|tumou?rs?) (situated|located)|previously irradiated|considered as (TLs?|target))/i;
export const NON_MEASURABLE = /\b(non-?measurable|no measurable|without measurable|not have measurable)\b/i;

/** Relapsed / refractory / recurrent disease. */
export const RECURRENT = /\b(relapsed|relapse|refractory|recurrent|recurrence|recurred|progressed|progressive disease|disease progression|r\/r|rr[a-z]{2,4})\b/i;
/** Recurrence words that are not about the cancer itself. */
export const RECURRENT_NOT_DISEASE = /\b(recurrent|refractory)\s+(epilepsy|hypertension|diarrh?ea|cough|dyspnea|hyponatremia|infections?|pneumonia|pleural|ascites|effusions?|thrombo|seizures?|nausea|hypercalcemia|hypokalemia|vomiting|uti|urinary tract|bleeding|syncope|angina|pericardial|pancreatitis|bowel obstruction|cytopenia|anemia|hypotension|pain)|\b(refractory|resistant)\s+to\s+(platinum|endocrine|hormone|castration|radioactive iodine|RAI|anti-?PD|immunotherapy|checkpoint|chemotherapy|BCG|treatment with)|\brelapse[- ]free\b|\b(risk|risks)\s+(of|for)\s+(recurrence|relapse)|\bwith a recurrence score\b|\brecurrence score\b|\b(oncotype|mammaprint)\b|\bpost[- ]?(op|operative)\b[^.;]{0,30}\brecurrence\b|\bno (evidence of )?(disease )?(recurrence|relapse|progression)/i;
export const NEW_OR_RECURRENT_ALT = /\b(newly diagnosed|untreated|treatment[- ]na[iï]ve|previously untreated|first[- ]line|frontline|front[- ]line|de novo|primary)\b[^.;]{0,40}\b(or|and\/or)\b|\b(or|and\/or)\b[^.;]{0,25}\b(newly diagnosed|untreated|treatment[- ]na[iï]ve|previously untreated|de novo)\b|\b(?:new|newly diagnosed|initial)\s+(?:and|&)\s+(?:recurrent|relapsed|refractory|progressive)\b|\b(?:recurrent|relapsed|refractory|progressive)\s+(?:and|&)\s+(?:new|newly diagnosed)\b/i;

/** Prior lines of therapy. Only generic counts ("lines of systemic therapy"), not class-specific ones ("lines of endocrine therapy"). */
export const LINES_UNIT = String.raw`(prior |previous |earlier )?(standard |systemic |anti-?cancer |anti-?neoplastic |treatment |therapeutic |systemic anti-?cancer |anti-?myeloma |anti-?lymphoma |(standard[- ]of[- ]care |SOC )?)?(lines?|regimens?|LOTs?|treatments? lines?)\b(\s+of\s+(prior |previous )?(systemic |anti-?cancer |anti-?neoplastic |standard[- ]of[- ]care |standard |myeloma[- ]directed |anti-?myeloma |anti-?lymphoma |anti-?leukemia |)?(therapy|therapies|treatments?|regimens?))?`;
/** Class words that make a line count class-specific (and so not a total-line rule). */
export const LINES_CLASS_SPECIFIC = /\b(lines?|regimens?)\s+of\s+(prior |previous )?(endocrine|hormon|anti-?HER2|HER2|platinum|cytotoxic|chemotherapy|immunotherapy|anti-?PD|checkpoint|taxane|targeted|ADT|androgen|ARPI|BRAF|EGFR|TKI|CDK|PARP|bispecific|CAR|BTK|anti-?CD|ICI|fluoropyrimidine|gemcitabine|BCG|intravesical)/i;
export const LINES_NO_LIMIT = /\bno (limit|maximum|restriction)\b|\bunlimited\b|\bany number of\b|\bregardless of (the )?number\b/i;

/** Other (prior or concurrent) malignancy. */
export const OTHER_CANCER = /\b(other|another|second|secondary|additional|prior|previous|history of|concurrent|concomitant|coexisting|co-existing|synchronous|separate|different|known)\b[^.;]{0,40}\b(?<!anti-)(?<!anti)(malignanc(y|ies)|cancers?|neoplasms?|primary tumou?rs?|invasive (cancer|carcinoma)|primary (cancer|malignancy))\b(?!\s*(-?directed |-?related )?(therap|treatment|agents?|drugs?|risk|genetic|predisposition|screening|syndrome|medications?|regimens?|immunotherapy))|\bsecond primary\b/i;
export const OTHER_CANCER_ACTIVE = /\b(active|uncontrolled|actively|currently (being )?treated|receiving (?:systemic |active )?(?:treatment|therapy)|under(going)? (active )?treatment|requir(ed|es|ing) (active |systemic |ongoing )?(treatment|therapy)|progressing|progressive|that is progressing|evidence of (active )?disease|ongoing treatment|receiving (active )?treatment)\b/i;
export const OTHER_CANCER_JUDGMENT = /\b(could affect|may affect|affect (?:compliance|the interpretation)|compliance|interpret\w*|difficult to interpret|competing risks?|confound\w*|potential to interfere|could (interfere|confound)|may interfere|would interfere|interfere with (the )?(safety|efficacy|assessment|interpretation|evaluation|study)|natural history)\b/i;
/** "within 3 years", "in the past five years", "disease-free for ≥ 2 years", "less than 3 years". */
export const YEARS_WINDOW = new RegExp(String.raw`(?:within|in|during|for|past|last|previous|preceding|less than|<|≤|<=|at least|≥|>=|more than|>|over|of)\s*(?:the\s+)?(?:past|last|previous|preceding)?\s*\(?${NUM}\)?\s*(?:\(\s*\d+\s*\)\s*)?(?:full\s+)?years?`, "i");

/** HIV. */
export const HIV = /\b(HIV|human immunodeficiency virus|AIDS)\b/i;
export const HIV_CONTROLLED_CARVEOUT = /\b(uncontrolled|not (well[- ])?controlled|poorly controlled|detectable viral load|unless|except|eligible|allowed|permitted|provided|if (they|the|on|their)|may (participate|enroll|be eligible)|undetectable|viral load|CD4|antiretroviral|anti-retroviral|\bART\b|HAART|well[- ]controlled|active (HIV )?infection|AIDS[- ]defining|opportunistic)\b/i;
/** Inclusion criteria for HIV-associated cancers (the trial is for people with HIV). */
export const HIV_REQUIRED = /\b(HIV[- ](associated|related|positive|infected|seropositive)|people (living )?with HIV|PLWH|persons with HIV|documented HIV|HIV infection (must|is required)|must (have|be) (HIV|documented HIV))/i;

export const HEP_B = /\b(hepatitis B|HBV|HBsAg|hepatitis B surface antigen|Hep B)\b/i;
export const HEP_C = /\b(hepatitis C|HCV|Hep C|hepatitis B (or|and|\/|and\/or) C)\b/i;
export const HEP_ACTIVE_CARVEOUT = /\b(active|chronic active|uncontrolled|replicating|detectable|unless|except|eligible|allowed|permitted|provided|if (they|the|on|their|HBV|HCV)|cured|resolved|treated|undetectable|antiviral|suppress\w*|requiring treatment|untreated|acute|viral load (below|<|less than|of <))\b/i;

export const ORGAN_TRANSPLANT = /\b(solid[- ]organ|organ|kidney|renal|liver|hepatic|heart|cardiac|lung|pancreas)\s+(allo)?(transplant|transplantation|allograft|graft)\b|\ballogeneic tissue\/solid organ|\btissue\/solid organ\b|\borgan (allo)?graft\b/i;
export const ALLO_SCT = /\b(allogeneic|allo-?)[- ]?(hematopoietic |haematopoietic |peripheral blood |bone marrow |stem[- ]cell |HSC |HCT |SCT |HSCT |BMT )*(stem[- ]cell|cell|HSCT|SCT|HCT|BMT|bone marrow|transplant(ation)?|graft)\b|\ballo-?(HSCT|SCT|HCT|BMT|transplant)\b/i;
/** Transplant described as a planned/future event or a donor procedure (not a history). */
export const TRANSPLANT_FUTURE = /\b(candidates?|eligible (for|to)|planned|plan(ned|ning|s)? to|scheduled|undergo(ing)?|will (receive|undergo|be)|referred|suitable|intend(ed|ing)?|proceed(ing)? to|donor|recipients? of (a )?first|consolidat\w*|bridge to|being considered|considered for|prepar\w*|conditioning|myeloablative|reduced[- ]intensity|graft[- ]versus|GVHD|GvHD|engraftment|post[- ]transplant (cyclophosphamide|maintenance))\b/i;
export const TRANSPLANT_PRIOR = /\b(prior|previous(ly)?|history of|received|underwent|undergone|had|after|following|post[- ]?(allogeneic|allo|transplant)|relapsed? (after|post|following)|status post|s\/p)\b/i;

export const AUTOIMMUNE = /\bauto-?immune (disease|disorder|condition|illness|diseases|disorders|conditions|hepatitis|colitis)|\bautoimmunity\b/i;

export const HEART_DISEASE = /\b(congestive heart failure|heart failure|\bCHF\b|myocardial infarction|heart attack|unstable angina|cardiomyopathy|NYHA|New York Heart Association|(clinically )?significant (cardiac|cardiovascular|heart) (disease|condition|disorder|dysfunction)|cardiac (disease|disorder)s?|cardiovascular disease)\b/i;
export const KIDNEY_DISEASE = /\b(dialysis|hemodialysis|haemodialysis|end[- ]stage (renal|kidney)|ESRD|ESKD|renal failure|kidney failure|chronic kidney disease)\b/i;
export const LIVER_DISEASE = /\b(cirrhosis|cirrhotic|Child[- ]Pugh (class |score )?(B|C)|hepatic (failure|decompensation|encephalopathy)|decompensated liver|liver failure|chronic liver disease|portal hypertension)\b/i;
/** Organ-disease words used as lab/measurement thresholds, which patients cannot self-report. */
export const ORGAN_LAB = /\b(LVEF|ejection fraction|QTc|creatinine|clearance|eGFR|GFR|bilirubin|AST|ALT|transaminase|albumin|ULN|mL\/min)\b/i;

/** Group-specific disease status. */
export const CRPC = /\b(castrat(e|ion)[- ](resistant|refractory)|m?CRPC|nmCRPC|hormone[- ](refractory|resistant)|androgen[- ]independent)\b/i;
export const CSPC = /\b(castrat(e|ion)[- ](sensitive|naive|naïve)|m?CSPC|m?HSPC|hormone[- ](sensitive|naive|naïve)|androgen[- ]sensitive)\b/i;
export const PLATINUM_RESISTANT = /\bplatinum[- ]resistant\b|\bPROC\b/i;
export const PLATINUM_SENSITIVE = /\bplatinum[- ]sensitive\b|\bPSOC\b/i;
export const MIBC = /\b(?<!non-?\s?)(?<!non )muscle[- ]invasive\b|\bMIBC\b/i;
export const NMIBC = /\bnon[- ]?muscle[- ]invasive\b|\bNMIBC\b/i;
export const UNRESECTABLE = /\b(unresectable|non-?resectable|not (surgically )?resectable|inoperable|not amenable to (curative |surgical )?(resection|surgery)|not a candidate for (curative )?(resection|surgery))\b/i;
export const RESECTABLE = /\b(?<!un)(?<!non-)(?<!non)(?<!borderline )(?<!borderline-)resectable\b|\bamenable to (curative )?(surgical )?resection\b/i;
export const BORDERLINE = /\bborderline[- ]resectable\b/i;
export const RAI_REFRACTORY = /\b(radioactive iodine|radio-?iodine|RAI|I-?131)[- ](refractory|resistant)\b|\bRAI-?R\b|\brefractory to (radioactive iodine|radio-?iodine|RAI)\b/i;
export const LOCALLY_ADVANCED = /\blocally[- ]advanced\b|\blocoregionally advanced\b/i;
export const ADJUVANT_SETTING = /\b(completely resected|complete(ly)? (surgical )?resect(ed|ion)|R0 resection|(has|have|had) (undergone|had) (a )?(complete |curative[- ]intent |curative |definitive |radical )?(surgical )?(resection|surgery)|(following|after|post) (a )?(complete |curative[- ]intent |curative |definitive )?(surgical )?resection|in the adjuvant setting|adjuvant (therapy|treatment) (setting|indicated|is planned))/i;
/** Resection or adjuvant wording about the future or a hypothetical (neoadjuvant/surgical candidates). */
export const ADJUVANT_FUTURE = /\b(achievable|feasible|possible|planned|plan(ning)? to|candidates? for|eligible for|allowing|amenable|scheduled|will (undergo|have)|potentially|expected|intend|resectable)\b/i;

/** Histology / subtype patterns; `groups` = only for trials in these cancer groups. */
interface HistologyPattern {
  id: HistologyId;
  groups: readonly CancerGroupId[];
  re: RegExp;
  /** "Not this histology" wording that makes it excluded inside an inclusion criterion. */
  negated?: RegExp;
}
export const HISTOLOGY_PATTERNS: readonly HistologyPattern[] = [
  { id: "nsclc", groups: ["lung"], re: /\b(NSCLC|non[- ]?small[- ]cell lung|non[- ]small[- ]cell (carcinoma|cancer)|non-?small cell lung)/i },
  { id: "sclc", groups: ["lung"], re: /(?<!non[- ]?)(?<!non)\b(SCLC|small[- ]cell lung (cancer|carcinoma)|small[- ]cell carcinoma of the lung|small[- ]cell (cancer|carcinoma)|extensive[- ]stage (small|SCLC|disease)|ES-SCLC|LS-SCLC)\b/i },
  { id: "lung_squamous", groups: ["lung"], re: /(?<!non[- ]?)(?<!non)(?<!(?:head and neck|head & neck|skin|cutaneous|oral|oropharyngeal|esophageal|oesophageal|cervical|anal|vulvar|penile|laryngeal|bladder|urothelial|nasopharyngeal)\s+)\bsquamous\b(?![^.;]{0,25}\b(?:head|neck|skin|cutaneous|oral|oropharyn\w*|(?:o)?esophag\w*|cervi\w*|anal|anus|vulv\w*|penile|laryn\w*|hypopharyn\w*|nasopharyn\w*|bladder|urothelial))/i, negated: /\bnon[- ]?squamous\b/i },
  { id: "mesothelioma", groups: ["lung"], re: /\bmesothelioma\b/i },
  { id: "aml", groups: ["leukemia"], re: /\b(AML|acute myeloid leuk\w*|acute myelogenous leuk\w*|acute non-?lymphocytic)\b/i },
  { id: "all", groups: ["leukemia"], re: /\b(B-ALL|T-ALL|acute lymphoblastic leuk\w*|acute lymphocytic leuk\w*|(Ph\+?|B-cell|T-cell) ALL)\b|\bALL\b(?!\s+(PATIENTS|SUBJECTS|PARTICIPANTS|COHORTS|ARMS|PARTS|GROUPS|OF|OTHER))/ },
  { id: "cll", groups: ["leukemia", "lymphoma"], re: /\b(CLL|chronic lymphocytic leuk\w*|SLL|small lymphocytic lymphoma)\b/i },
  { id: "cml", groups: ["leukemia"], re: /\b(CML|chronic myeloid leuk\w*|chronic myelogenous leuk\w*)\b/i },
  { id: "mds", groups: ["leukemia"], re: /\b(MDS|myelodysplastic syndromes?|myelodysplasia)\b/i },
  { id: "dlbcl", groups: ["lymphoma"], re: /\b(DLBCL|diffuse large B[- ]cell)\b/i },
  // Case-insensitive words; "FL" stays upper-case only (it is a common English pair of letters otherwise).
  { id: "follicular", groups: ["lymphoma"], re: /\b(?:[Ff]ollicular (?:[Ll]ymphomas?|NHL)|FOLLICULAR LYMPHOMA|FL\b(?=\s*(?:grade|\(|,|or|and|\)|patients)))/ },
  { id: "mantle_cell", groups: ["lymphoma"], re: /\b(mantle[- ]cell|MCL)\b/i },
  { id: "marginal_zone", groups: ["lymphoma"], re: /\b(marginal[- ]zone|MZL|MALT lymphoma)\b/i },
  { id: "hodgkin", groups: ["lymphoma"], re: /(?<!non[- ]?)(?<!non)\b(hodgkin('?s)? (lymphoma|disease)|classical hodgkin|cHL)\b/i },
  { id: "t_cell_lymphoma", groups: ["lymphoma"], re: /\b(T[- ]cell lymphoma|PTCL|CTCL|mycosis fungoides|S[ée]zary|anaplastic large[- ]cell|ALCL|T[- ]cell non-?hodgkin)\b/i },
  { id: "cns_lymphoma", groups: ["lymphoma"], re: /\b(primary (CNS|central nervous system) lymphoma|PCNSL|primary vitreoretinal lymphoma)\b/i },
  { id: "smoldering_myeloma", groups: ["myeloma"], re: /\b(smou?ldering (multiple )?myeloma|SMM)\b/i },
  { id: "amyloidosis", groups: ["myeloma"], re: /\b(AL amyloidosis|amyloidosis)\b/i },
  { id: "endometrial", groups: ["uterine-cervical"], re: /\b(endometrial (cancer|carcinoma|adenocarcinoma|serous)|carcinoma of the endometrium|uterine (cancer|carcinoma|serous|carcinosarcoma|corpus)|endometrial)\b(?!\s*(thickness|biopsy|sampling|stripe|hyperplasia))/i },
  { id: "cervical", groups: ["uterine-cervical"], re: /\b(cervical (cancer|carcinoma|squamous|adenocarcinoma)|carcinoma of the (uterine )?cervix|cancer of the (uterine )?cervix)\b/i },
  { id: "hcc", groups: ["liver"], re: /\b(HCC|hepatocellular)\b/i },
  { id: "biliary", groups: ["liver"], re: /\b(cholangiocarcinoma|biliary tract (cancer|carcinoma)|BTC|gallbladder (cancer|carcinoma)|bile duct (cancer|carcinoma)|ampullary (cancer|carcinoma))\b/i },
  { id: "esophageal_squamous", groups: ["gastroesophageal"], re: /\b(ESCC|(o)?esophageal squamous|squamous cell carcinoma of the (o)?esophagus|squamous (cell )?(carcinoma|histology)[^.;]{0,20}(o)?esophag)\w*/i },
  { id: "gastroesophageal_adeno", groups: ["gastroesophageal"], re: /\b(gastric|gastro-?(o)?esophageal junction|GEJ|GEJC|(o)?esophageal|stomach)\b[^.;]{0,25}\badenocarcinoma|\badenocarcinoma of the (stomach|(o)?esophagus|gastro)/i },
  { id: "pdac", groups: ["pancreatic"], re: /\b(PDAC|pancreatic (ductal )?adenocarcinoma|adenocarcinoma of the pancreas|ductal adenocarcinoma)\b/i },
  { id: "pnet", groups: ["pancreatic"], re: /\b(pNETs?|PNETs?|pancreatic neuroendocrine|neuroendocrine (tumou?rs?|neoplasms?|carcinomas?) of the pancreas|islet cell|(pancreatic )?neuroendocrine (tumou?r|neoplasm|carcinoma|histology|features))\b/i },
  { id: "glioblastoma", groups: ["brain"], re: /\b(glioblastoma|GBM|grade (4|IV) (astrocytoma|glioma))\b/i },
  { id: "lower_grade_glioma", groups: ["brain"], re: /\b(low(er)?[- ]grade gliomas?|LGG|grade (2|3|II|III) (gliomas?|astrocytomas?|oligodendrogliomas?)|oligodendrogliomas?)\b/i },
  { id: "meningioma", groups: ["brain"], re: /\bmeningiomas?\b/i },
  { id: "uveal_melanoma", groups: ["melanoma"], re: /\b(uveal|ocular|choroidal) melanoma\b|\buveal\b/i },
  { id: "mucosal_melanoma", groups: ["melanoma"], re: /\bmucosal\b(?=[^.;]{0,25}melanoma)|\bmelanoma[^.;]{0,25}\bmucosal\b|\bmucosal lentiginous\b/i },
  { id: "cutaneous_scc", groups: ["melanoma"], re: /\b(cutaneous squamous[- ]cell|cSCC|CSCC|squamous[- ]cell (carcinoma|cancer) of the skin)\b/i },
  { id: "merkel_cell", groups: ["melanoma"], re: /\bmerkel\b/i },
  { id: "clear_cell_rcc", groups: ["kidney"], re: /(?<!non[- ]?)(?<!non)\b(clear[- ]cell|ccRCC)\b/i, negated: /\bnon[- ]?clear[- ]cell\b|\bnccRCC\b/i },
  { id: "gist", groups: ["sarcoma"], re: /\b(GIST|gastrointestinal stromal)\b/i },
  { id: "osteosarcoma", groups: ["sarcoma"], re: /\bosteosarcoma\b/i },
  { id: "ewing", groups: ["sarcoma"], re: /\bewing/i },
  { id: "differentiated_thyroid", groups: ["thyroid"], re: /\b(differentiated thyroid|DTC|papillary thyroid|follicular thyroid|PTC)\b/i },
  { id: "medullary_thyroid", groups: ["thyroid"], re: /\b(medullary thyroid|MTC)\b/i },
  { id: "anaplastic_thyroid", groups: ["thyroid"], re: /\b(anaplastic thyroid|ATC)\b/i },
  { id: "hnscc", groups: ["head-neck"], re: /\b(HNSCC|SCCHN|squamous[- ]cell (carcinoma|cancer) of the (head|oral|oropharynx|larynx|hypopharynx)|head and neck squamous|(oral|oral cavity|oropharyngeal|laryngeal|hypopharyngeal) (squamous|SCC|cancer|carcinoma))\b/i },
  { id: "nasopharyngeal", groups: ["head-neck"], re: /\b(nasopharyn(geal|x)|NPC)\b/i },
  { id: "salivary", groups: ["head-neck"], re: /\bsalivary\b/i },
  { id: "rectal", groups: ["colorectal"], re: /\b(rect(al|um)) (cancer|adenocarcinoma|carcinoma|tumou?r)|\brectal\b(?!\s*(exam|bleeding|temperature))/i },
  { id: "anal", groups: ["colorectal"], re: /\b(anal (cancer|canal|carcinoma|squamous|SCC)|squamous[- ]cell carcinoma of the anus|anus)\b/i },
  { id: "hgsoc", groups: ["ovarian"], re: /\b(high[- ]grade serous|HGSOC|HGSC)\b/i },
  { id: "ovarian_clear_cell", groups: ["ovarian"], re: /\b(clear[- ]cell (ovarian|carcinoma|histology)|ovarian clear[- ]cell|OCCC)\b/i },
  { id: "low_grade_serous_ovarian", groups: ["ovarian"], re: /\b(low[- ]grade serous|LGSOC|LGSC)\b/i },
  { id: "prostate_neuroendocrine", groups: ["prostate"], re: /\b(neuroendocrine (prostate|carcinoma|features|differentiation|histology|component|tumou?r)|small[- ]cell (prostate|carcinoma|histology|component|features)|t?-?NEPC|treatment[- ]emergent neuroendocrine)\b/i },
  { id: "upper_tract_urothelial", groups: ["bladder"], re: /\b(upper[- ](tract|urinary tract)|UTUC|UTUC|renal pelvis|ureter(al)?)\b/i },
];

/** Prior drug classes (`prior_drug:<id>`). Brand/generic names commonly used in criteria. */
export const DRUG_CLASS_PATTERNS: Readonly<Record<DrugClassId, RegExp>> = {
  checkpoint: /\b(anti-?PD-?1|anti-?PD-?L-?1|anti-?CTLA-?4|PD-?1\/PD-?L1|PD-?(L)?1 (\/ ?PD-?L1 )?(inhibitors?|blockade|antibod\w+|targeted|directed|axis)|CTLA-?4 (inhibitors?|blockade|antibod\w+)|immune checkpoint (inhibitors?|blockade|therapy)|checkpoint inhibitors?|\bICIs?\b|pembrolizumab|nivolumab|atezolizumab|durvalumab|ipilimumab|cemiplimab|dostarlimab|avelumab|tislelizumab|toripalimab|tremelimumab|retifanlimab|sintilimab|camrelizumab|relatlimab|programmed (cell )?death)\b/i,
  platinum: /\b(platinum|cisplatin|carboplatin|oxaliplatin)\b/i,
  taxane: /\b(taxanes?|paclitaxel|docetaxel|cabazitaxel|nab-?paclitaxel)\b/i,
  endocrine: /\b(endocrine (therapy|therapies|treatment|agents?)|aromatase inhibitors?|\bAIs?\b(?= \(|,| or| and)|tamoxifen|fulvestrant|letrozole|anastrozole|exemestane|SERDs?|elacestrant|camizestrant|imlunestrant)\b/i,
  cdk46: /\b(CDK ?4\/6|CDK4\/6i|CDK 4\/6|palbociclib|ribociclib|abemaciclib)\b/i,
  anti_her2: /\b(anti-?HER-?2|HER-?2[- ](directed|targeted) (therapy|therapies|treatment|agents?)|trastuzumab(?! (deruxtecan|emtansine))|pertuzumab|lapatinib|tucatinib|neratinib|margetuximab|zanidatamab)\b/i,
  adc: /\b(antibody[- ]drug conjugates?|ADCs?|trastuzumab deruxtecan|T-?DXd|DS-?8201|sacituzumab|enfortumab|trastuzumab emtansine|T-?DM1|ado-?trastuzumab|datopotamab|Dato-?DXd|mirvetuximab|tisotumab|loncastuximab|brentuximab|polatuzumab|belantamab|telisotuzumab|patritumab)\b/i,
  egfr_tki: /\b(EGFR[- ](TKIs?|tyrosine kinase inhibitors?|inhibitors? \(TKIs?\)|TKI-directed)|osimertinib|erlotinib|gefitinib|afatinib|dacomitinib|lazertinib|amivantamab)\b/i,
  alk_tki: /\b(ALK[- ](TKIs?|tyrosine kinase inhibitors?|inhibitors?|targeted|directed)|alectinib|crizotinib|lorlatinib|brigatinib|ceritinib|ensartinib)\b/i,
  parp: /\b(PARP ?(inhibitors?|i)|PARPi|olaparib|niraparib|rucaparib|talazoparib|veliparib|saruparib)\b/i,
  arpi: /\b(androgen receptor (pathway |signaling |signalling |axis[- ]targeted |targeted )?(inhibitors?|antagonists?|agents?|targeted (therapy|agents?))|ARPIs?|ARSIs?|ARTAs?|novel hormonal (agents?|therap\w+)|NHAs?|second[- ]generation (anti-?androgens?|AR)|abiraterone|enzalutamide|apalutamide|darolutamide)\b/i,
  lu_psma: /\b(177 ?Lu-?PSMA|Lu-?PSMA|lutetium[^.;]{0,30}PSMA|\[177Lu\][^.;]{0,15}PSMA|Pluvicto|PSMA[- ](targeted )?radioligand|PSMA-?(targeted )?RLT)\b/i,
  braf_mek: /\b(BRAF (and\/or |or |\/)?(MEK )?inhibitors?|MEK inhibitors?|BRAF\/MEK|dabrafenib|trametinib|vemurafenib|encorafenib|binimetinib|cobimetinib)\b/i,
  anti_vegf: /\b(bevacizumab|ramucirumab|aflibercept|anti-?VEGF(-?A)? (antibod\w+|therapy|agents?|monoclonal)|anti-?angiogenic (antibod\w+|therapy|agents?))\b/i,
  vegf_tki: /\b(VEGFR?[- ](TKIs?|tyrosine kinase inhibitors?|targeted (TKI|tyrosine))|sunitinib|pazopanib|cabozantinib|axitinib|lenvatinib|sorafenib|regorafenib|tivozanib|fruquintinib)\b/i,
  fluoropyrimidine: /\b(fluoropyrimidines?|5-?FU|5-?fluorouracil|fluorouracil|capecitabine|FOLFOX|FOLFIRI|FOLFIRINOX|FOLFOXIRI|CAPOX|XELOX|S-1|trifluridine)\b/i,
  hma: /\b(hypomethylating agents?|HMAs?|azacitidine|azacytidine|decitabine|guadecitabine)\b/i,
  venetoclax: /\b(venetoclax|BCL-?2 inhibitors?)\b/i,
  car_t: /\b(CAR[- ]?T|CAR T[- ]cells?|chimeric antigen receptor|axicabtagene|tisagenlecleucel|lisocabtagene|idecabtagene|ciltacabtagene|brexucabtagene|obecabtagene|axi-?cel|tisa-?cel|liso-?cel|ide-?cel|cilta-?cel)\b/i,
  anti_cd20: /\b(anti-?CD20|CD20[- ](directed|targeted) (monoclonal |antibod)|rituximab|obinutuzumab|ofatumumab)\b/i,
  btk: /\b(BTK ?(inhibitors?|i)|BTKi|Bruton'?s? tyrosine kinase|ibrutinib|acalabrutinib|zanubrutinib|pirtobrutinib)\b/i,
  bispecific: /\b(bispecific (antibod\w+|T[- ]cell engagers?|agents?|therap\w+)|T[- ]cell engag(er|ing)s?|BiTEs?|TCEs?|blinatumomab|glofitamab|epcoritamab|mosunetuzumab|odronextamab|teclistamab|elranatamab|talquetamab|linvoseltamab|tarlatamab)\b/i,
  anti_cd38: /\b(anti-?CD38|CD38[- ](directed|targeted|monoclonal)|daratumumab|isatuximab)\b/i,
  imid: /\b(IMiDs?|immunomodulatory (drugs?|agents?|imide)|lenalidomide|pomalidomide|thalidomide|iberdomide|mezigdomide)\b/i,
  proteasome_inhibitor: /\b(proteasome inhibitors?|bortezomib|carfilzomib|ixazomib)\b/i,
  bcma: /\b(BCMA[- ]?(directed|targeted|targeting|CAR|bispecific|TCE|therapy|therapies|agents?)|anti-?BCMA|belantamab|idecabtagene|ciltacabtagene|teclistamab|elranatamab|linvoseltamab)\b/i,
  temozolomide: /\b(temozolomide|TMZ)\b/i,
  bcg: /\b(BCG|Bacill(us|e) Calmette)\b/,
  auto_sct: /\b(autologous (hematopoietic |haematopoietic |peripheral blood )?(stem[- ]cell|HSCT|SCT|HCT|transplant\w*|bone marrow)|auto-?(HSCT|SCT|HCT|transplant)|ASCT)\b/i,
};

/** "with or without X" names an option, never a requirement or exclusion. */
export const WITH_OR_WITHOUT = /\bwith or without\b|\bwith\/without\b|\+\/-|±/i;

// ---------------------------------------------------------------------------------------------
// Rules version 4 (precision work on histology, lines, prior drugs, stage, relapsed/refractory,
// other cancer, hepatitis, autoimmune and catalog biomarkers). Tuned on the development partition only.
// ---------------------------------------------------------------------------------------------

/** A header line that introduces alternatives ("one of the following indications:"); clauses below it are options, not requirements. */
export const ALT_HEADER = /\b(one of the following|any of the following|at least one of the following|either of the following|one or more of the following|any one of|(?:one|1) of:|one of (?:the |these )?(?:\w+ )?(?:following|cohorts?|groups?|categories|arms?|settings|populations?|scenarios)|following (?:cohorts?|indications?|populations?|diseases?|tumou?r types?|histolog\w+|subtypes?|conditions|groups|settings|scenarios)|eligible (?:diagnos[ie]s|cohorts|indications))\b/i;
/** Words that make a "Label:" prefix a generic heading rather than a population/cohort label. */
export const GENERIC_LABEL = /\b(prior|previous|therapy|therapies|treatment|treatments|medications?|history|criteria|requirements?|status|disease|lines?|regimens?|exposure|measurable|performance|ECOG|organ|function|laboratory|hematolog\w*|note|notes|exceptions?|examples?|definitions?|setting|stage|resection|surgery|radiation|chemotherapy|biomarker|mutation|testing|informed|consent|age|sex|diagnosis|brain|cns|metastas\w*|infection|cardiac|pregnan\w*|contracepti\w*)\b/i;
/** "For participants with X:", "In dose expansion," openers: the rule applies to a subgroup. */
export const SUBGROUP_OPENER = /^\s*(?:[*•-]\s*)*(?:\(?[a-z0-9]{1,3}[.)]\s*)?(?:(?:for|in|among)\s+(?:the\s+)?(?:\S+\s+){0,3}?(?:participants|patients|subjects|those|men|women|cohorts?|parts?|arms?|expansion|escalation|phase\s*\w+)\b|for\s+[^:,;]{1,60}?(?:\s[-–—]\s|:))/i;
/** Count of lines that is really about a sub-population/step: "after CAR-T", "prior to ASCT", "excluding targeted therapy", "depending on subtype". */
export const LINES_SUBSET = /\b(depending on|dependent on|according to (?:the )?(?:histolog|subtype|cohort|disease)|(?:excluding|not counting|not including|other than|except(?: for)?|apart from)\b[^.;]{0,40}\b(?:therap|regimen|lines?|treatments?|agents?|maintenance|adjuvant|hormon|endocrine|targeted|radiation)|lines?(?: of (?:\w+ ){0,2}(?:therapy|treatment))? (?:after|following|since|post)\b|(?:after|following|since) (?:the )?(?:administration|receipt|initiation|infusion|failure) of (?:their |the |a )?(?:previous |prior )?(?:CAR|bispecific|transplant|ASCT)|(?:prior to|before) (?:ASCT|autologous|allogeneic|transplant|CAR|stem cell|HCT|SCT|maintenance|study entry from))\b/i;
/** The count is for lines that must/can be a class ("no more than 2 lines can be a TKI"). */
export const LINES_MODAL_CLASS = /\b(?:lines?|regimens?)(?:\s+of\s+(?:\w+\s+){0,2}(?:therapy|treatment))?\s+(?:can|may|could|must|should|have to|has to)\s+(?:be|have\s+(?:contained|included))\b|\b(?:of which|at least one (?:of which|line)|at least one (?:line|regimen))\b[^.;]{0,30}\b(?:must|should)\s+(?:have\s+)?(?:contain|includ|be)/i;
/** Permission wording: a range of lines "may" have been received, so the minimum is not required. */
export const LINES_MAY = /\b(?:may|can|could|are allowed to|is allowed to|allowed to)\s+(?:have\s+)?(?:previously\s+)?(?:received|had|been treated|undergone)\b|\b(?:is|are)\s+(?:allowed|permitted|acceptable|permissible)\b|\bpermissible\b/i;

// --- Prior drug classes ---
/** Dosing, reproductive and counseling text that names the study drug (not a treatment history). */
export const DRUG_REPRODUCTIVE = /\b(contracepti\w*|pregnan\w*|breast-?feed\w*|embryo\w*|fet(?:al|us)|foetal|sperm|condoms?|abstinen\w*|childbearing|fertility|reproductive|teratogen\w*|REMS|donat\w+ (?:sperm|eggs?|ova))\b/i;
/** Elapsed-time, interval and duration wording: a washout or timing rule, not a "ever received" rule. */
export const DRUG_TIMING = /\b(elapsed|since (?:the )?(?:last|completion|end|date|transplant|allogeneic|autologous|prior|previous|first|initial)|interval|continued for|within\s+(?:the\s+)?(?:last|past|previous|prior|\d+|one|two|three|four|five|six|twelve)\b|(?:≥|>=|>|<|≤|<=|at least|minimum of|a minimum of|more than|less than|over|under)\s*\d+\s*(?:weeks?|days?|months?|years?)\b|\d+\s*(?:weeks?|days?|months?|years?)\s+(?:since|after|from|post|following|elapsed|before|ago)|days? post|post-?transplant|from the date of the last|within (?:protocol|the protocol)|protocol[- ]specified|specified intervals?|prior to receipt|before receipt)\b/i;
/** "Recommended but not mandatory": the drug history is optional. */
export const DRUG_OPTIONAL = /\b(recommended|may be (?:included|enrolled|eligible)|can be (?:included|enrolled|on)|counts? (?:as|towards?)|(?:is|are) defined as|exceptions? include|exclusion criteri\w+|^note\b|allowable|permissible|regardless|irrespective|independent of|whether or not|(?:will|does|do|did|would) not count|not counted|(?:may|might|can|could)\s+(?:also\s+)?have\s+(?:previously\s+)?(?:received|had|been)|not (?:mandatory|required|necessary|a requirement)|preferred|ideally|encouraged|optional|if (?:eligible|available|applicable|appropriate|clinically indicated)|unless (?:not eligible|contraindicated|intolerant)|or (?:are|is|were|was) (?:not eligible|ineligible|intolerant))\b/i;
/** Wording about stopping or holding the drug on study (a run-in rule, not a history). */
export const DRUG_STOP = /\b(stop|stopped|discontinu\w+|hold|withhold|withdraw\w*|cease|come off|remain off|off)\b[^.;]{0,35}$/i;
/** The drug is part of the study plan or the patient's current/planned care. */
export const DRUG_STUDY_PLAN = /\b(consent\w*|about to (?:start|begin|receive)|will be (?:given|treated|receiving|administered|enrolled)|expected to (?:receive|start)|candidates? (?:for|to)|enrolled (?:within|prior)|undergoing|leukapheresis|apheresis|will (?:be )?(?:receiv\w+|given|treated|taking|start\w*)|combination (?:therapy|treatment)s? with|(?:prior to|before)\s+(?:starting|initiating|beginning|receiving|the first dose|first dose|enrol\w*|randomi\w*|study)|manufactur\w+|infusion of (?:the )?study)\b/i;
/** Strong treatment-history wording that may precede a drug mention. */
export const DRUG_HISTORY_STRONG = /\b(prior(?! to)|previous(?:ly)?|received|receipt of|treated with|treatment with|therapy with|history of|exposure to|exposed to|na[iï]ve|pretreated|pre-treated|failed|failure of|resistant to|refractory to|relapsed (?:after|on|following|from)|progress(?:ed|ion)? (?:on|after|following|during|despite|through)|intolerant|had|undergone|underwent|lines? of)\b/i;
/** Progression/relapse wording that lets "after"/"following" count as history in an inclusion criterion. */
export const DRUG_PROGRESSION = /\b(progress\w*|relaps\w*|refractory|resistan\w*|fail\w*|recurr\w*|PD)\b/i;

// --- Histology / subtype ---
/** Diagnosis-confirming words right before a histology term. */
export const HISTOLOGY_CONFIRM = /\b(histolog\w*|cytolog\w*|patholog\w*|biops\w*|confirmed|documented|proven|diagnos\w*|established|verified)\b/i;
/** Response/definition clauses ("CR and PR are defined by iwCLL") are not diagnosis rules. */
export const HISTOLOGY_DEFINITION = /\b(?:is|are) defined as\b|\b(?:CR|PR|CRi|response|responses|progression|relapse|remission)\b[^.;]{0,40}\b(?:is|are|will be)?\s*defined\b|\bdefined (?:according|by|using) [^.;]{0,40}\b(?:criteria|guidelines)\b[^.;]{0,20}$/i;
/** A second/curable cancer list ("basal cell or squamous cell carcinoma of the skin", "in situ") names histologies of other cancers. */
export const HISTOLOGY_SECOND_CANCER = /\b(?:basal cell|in[- ]situ|adequately treated|curatively treated|other malignanc\w*|second primary|non-?melanoma|skin cancer|carcinoma of the skin|squamous cell carcinoma of the skin|cervical cancer in situ|superficial bladder)\b/i;
/** Treatment-history words before a histology term: the clause is about prior therapy, not the diagnosis. */
export const HISTOLOGY_THERAPY = /\b(?:prior|previous(?:ly)?|received|receiving|treated|treatment|therapy|therapies|chemotherapy|regimens?|radiotherapy|immunotherapy|surgery|resection|inhibitors?|transplant\w*|administered|for treating)\b[^.;]{0,60}$/i;
/** Molecular or phase qualifiers right before a histology term in an exclusion ("Ph+ leukemia", "FLT3-mutated AML"). */
export const HISTOLOGY_QUALIFIER = /\b(?:Ph\+?|Philadelphia|BCR-?ABL1?\+?|t\(\d+;\d+\)|FLT3\S*|NPM1\S*|TP53\S*|IDH\d?\S*|KMT2A\S*|MLL\S*|\w+-mutated|\w+-mutant|\w+-positive|\w+-negative|mature|relapsed|refractory|recurrent|progressive|therapy-related|secondary|high-risk|low-risk)\W*(?:\w+\W+){0,2}$/i;
/** A sub-grade or variant right after the term ("FL grade 3B", "DLBCL variant"): only that variant is meant. */
export const HISTOLOGY_SUBGRADE = /^\W{0,3}\w{0,12}\W{0,3}(?:grade\s*(?:3\s*b|iii\s*b|3b)|variants?\b|subtype\b[^.;]{0,5}$)/i;
export const HISTOLOGY_TRANSFORMED = /\b(?:transformation|transformed|Richter\w*|evolv\w+ (?:to|into|from)|progress\w* to)\b/i;
/** Testing/biomarker notes in exclusions ("molecular testing should be considered"). */
export const HISTOLOGY_TESTING = /\b(?:testing|tested|test results?|should be considered|not necessary|not required|is not exclusionary|not exclusionary)\b/i;

// --- Lines of therapy: alternatives and conditionals ---
/** "still eligible if they failed more than one line": who MAY join, not a requirement. */
export const LINES_ELIGIBLE_IF = /\b(?:still |also )?eligible (?:if|even if|provided|when)\b|\b(?:even if|regardless of|irrespective of)\b/i;
/** An alternative route to eligibility next to the line count: "ineligible for standard therapy or ...", "for whom no standard therapy". */
export const LINES_ALT = /\b(?:ineligible|not (?:a )?candidates?|no (?:standard|effective|available|curative|further)|unable to (?:receive|tolerate)|intolerant|refus\w+|declin\w+|unwilling|contraindicat\w+)\b[^.;]{0,80}\bor\b|\bor\b[^.;]{0,60}\b(?:ineligible|not (?:a )?candidates?|no (?:standard|effective|available)|refus\w+|declin\w+|for whom no)\b|\bor\s+(?:who\s+|that\s+)?(?:has|have|had)\s+(?:progressed|relapsed|failed|received|been)\b/i;
/** Another route after the count: "... 2 prior lines of therapy OR refractory to initial therapy". */
export const LINES_ALT_AFTER = /\b(?:lines?|regimens?|treatments?|therap(?:y|ies))\b[^.;]{0,40}[,;]?\s+\bor\s+(?:relaps\w+|refractory|primary refractory|progress\w+|ineligible|not (?:a )?candidates?|intolerant|who|those|patients|participants|have|has)\b|\sOR\s/;

// --- Stage setting ---
/** "No evidence of disease" only counts as an adjuvant/post-treatment state next to surgery or therapy wording. */
export const ADJUVANT_NED = /\b(?:no (?:radiographic |clinical |radiologic )?evidence of (?:residual |measurable )?disease(?! (?:progression|recurrence|relapse))|NED)\b/;
export const ADJUVANT_NED_CONTEXT = /\b(?:after|following|post|status post|s\/p|completion of|completed|undergone|underwent)\b[^.;]{0,50}\b(?:surgery|resection|surgical|therapy|treatment|chemoradi\w*|chemotherapy|radiation|radiotherapy|prostatectomy|mastectomy|colectomy)\b/i;
/** The clause is about another cancer, a note, a negation or a sampling/imaging procedure, not the patient's own resection status. */
export const ADJUVANT_NOT_STATUS = /\b(?:history of (?:other|another|prior|a prior)|other malignanc\w*|second primary|prior malignanc\w*|non-?breast|recommended|TIL\b|for (?:generation|manufactur\w+)|leukapheresis|TURBT|post-?operative (?:brain )?(?:MRI|imaging)|generation|visually|transurethral|papillary|including|such as|for which|defined as|can (?:safely )?be (?:achieved|performed|obtained)|deemed|assay|Signatera|surveillance|willing\w*|(?:administered|given)\b[^.;]{0,40}\badjuvant|will not|must not|should not|not (?:be )?(?:required|eligible|admitted)|exceptions?|except for)\b/i;
/** Locally advanced disease named inside a negation, a prior-therapy statement or a subgroup. */
export const LOCALLY_ADVANCED_NOT_STATUS = /\b(?:will not|must not|should not|not (?:be )?(?:admitted|eligible|amenable|required)|(?:treated|treatment|therapy|received|administered)\b[^.;]{0,40}\b(?:in the adjuvant|only in|for locally advanced)|in the context of|multimodal)\b/i;

// --- Relapsed / refractory ---
export const RECURRENT_NOT_DISEASE_V4 = /\bsteroid[- ](?:refractory|resistant)\b|\b(?:acute|chronic) (?:GVHD|graft)\b|\bGVHD\b|\bat (?:the time of )?(?:relapse|recurrence|progression)\b|\b(?:counts? as|considered as) (?:a )?(?:separate|one|an?)\b|\b(?:can|may) be considered\b|\bafter discussion with\b|\bto be considered (?:measurable|evaluable)\b|\b(?:treatment|therapy|regimens?) for (?:the )?(?:relapsed|recurrent|refractory|progressive)\b|\bor for whom\b|\b(?:is|are) defined as documentation\b|\brelapse(?:d)? is defined\b|\beither\b/i;

// --- Catalog biomarkers ---
/** Wording that makes a marker mention permissive, procedural or conditional rather than a requirement. */
export const V2_MARKER_PERMISSIVE = /\b(?:(?:are|is) (?:also )?eligible|also eligible|may be (?:enrolled|included|considered|eligible|resolved)|can be (?:enrolled|included|resolved)|(?:not|is not|are not) (?:be )?required|not acceptable|acceptable|allowed|permitted|approved by|discussion with|resolved by|uncertainty|if (?:available|applicable|presenting|diagnosed)|should be (?:considered|tested)|may include|include but|kinase domain|dose escalation|(?:mutation|methylation|expression|fusion|amplification) status|\+\/-|±)\b|\+\/-|±/i;
/** Specimen/testing procedure text ("tissue sample for detection of X", "may undergo genomic testing"). */
export const V2_MARKER_TESTING = /\b(?:undergo|assess for|screen\w*|genomic testing|sequencing|assay)\b|\b(?:sample|specimen|tissue|biopsy|archival)\b[^.;]{0,40}\bfor (?:the )?(?:detection|testing|analysis|determination|evaluation|assessment)\b/i;
/** The marker confirms a requirement outright. */
export const V2_MARKER_ASSERTED = /\b(?:must have|harbou?r\w*|documented|confirmed|presence of|evidence of|known|with (?:a |an )?\w*\s*(?:activating )?(?:mutation|fusion|amplification)|diagnos\w+ (?:of|with))\b/i;
/** A marker followed by "patients who/with ...": the exclusion applies to a sub-group. */
export const V2_MARKER_SUBGROUP_AFTER = /^\W{0,3}\w*\W{0,3}\w*\s+(?:patients|participants|subjects)\s+(?:who|with|whose)\b/i;

/** Any word that qualifies a hepatitis mention (active, chronic, history, positive, uncontrolled, viral load, ...). */
export const HEP_QUALIFIER = /\b(active|chronic|history of|reactive|positive|seropositive|uncontrolled|detectable|replicating|viral load|ongoing|current|known|untreated|acute|undetectable|cured|resolved|eligible|permitted|allowed|requir\w+)\b/i;

export const RECURRENT_NOT_REQUIREMENT = /\brefractory\b[^.;]{0,30}\b(?:effusions?|ascites)\b|\bthe term\b|\bsuspicio\w*\s+(?:for|of)\b|\bsuspected\b|\bmay\b|\sOR\s|^\s*(?:[*\u2022-]\s*)*(?:patients|participants|subjects)\s+who\s+(?:had|have|underwent|are)\b[^.;]{0,50}\b(?:must|should)\b/;

/** Virologic conditions that make a permissive hepatitis sentence a "detectable/active infection only" rule. */
export const HEP_VIROLOGIC_CONDITION = /\b(undetectable|not detectable|below the (?:limit|lower limit)|viral load|DNA|RNA|PCR|negative|suppress\w*|resolved|cleared?|clearance|cured|cure|antiviral|controlled|past)\b/i;
/** Hepatitis named as the carve-out of a wider exclusion ("active infection (except hepatitis B or C)"). */
export const HEP_CARVEOUT_LEAD = /\b(?:except(?: for)?|excluding|other than|apart from|with the exception of|not including)\b[^.;]{0,30}$/i;
/** Etiology of a liver cancer or eligibility that depends only on liver function, not on the infection. */
export const HEP_NOT_INFECTION_RULE = /\b(?:HBV|HCV)[- ]?HCC\b|\bnon-?viral[- ]HCC\b|\bliver function criteria\b|\bChild-?Pugh\b|\bhepatologist\b|\bchronic liver dysfunction\b/i;
/** The text defines the infection by test result and excludes it outright ("infection (HBsAg or HBV DNA positive)"). */
export const HEP_TEST_DEFINED = /\b(?:ie|i\.e\.?|defined as|HBsAg|surface antigen|HBV DNA|HCV RNA)\b[^.;]{0,40}\bpositive\b|\bpositive\b[^.;]{0,30}\b(?:HBsAg|surface antigen|HBV DNA|HCV RNA|HCV antibody|anti-?HCV)\b/i;
