# TREC Clinical Trials 2021/2022: data sources and terms

Checked on 2026-10-09.

## What was downloaded, and from where

All four files were downloaded from NIST's TREC data pages into `data/cache/trec/` (gitignored):

| File | URL | Size | MD5 |
| --- | --- | --- | --- |
| `topics2021.xml` (75 topics) | https://trec.nist.gov/data/trials/topics2021.xml | 64,618 B | `6d842b40387d760274447c1f8d7396a8` |
| `qrels2021.txt` (35,832 lines) | https://trec.nist.gov/data/trials/qrels2021.txt | 676,496 B | `0335d95c58d5f5fd9bc730bccb60ca90` |
| `topics2022.xml` (50 topics) | https://trec.nist.gov/data/trials/topics2022.xml | 32,423 B | `73bcb3985a17fd60d786f5d8f5a0bb2e` |
| `qrels2022.txt` (35,394 lines) | https://trec.nist.gov/data/trials/qrels2022.txt | 666,030 B | `64946c7c3dfc2f36dcb0e098a434fc9a` |

The files are linked from:

- https://trec.nist.gov/data/trials2021.html ("Test topics", "Judgment ('qrels') file")
- https://trec.nist.gov/data/trials2022.html (same)

The track web site also hosts the topics at http://www.trec-cds.org/topics2021.xml and http://www.trec-cds.org/topics2022.xml; those copies are byte-identical (same MD5) to the NIST copies.

The NIST pages describe the qrels scale as: "Judgment of 0 is non-relevant, 1 is excluded, and 2 is eligible." The track pages (http://www.trec-cds.org/2021.html, http://www.trec-cds.org/2022.html) describe the topics as "synthetic patient cases created by individuals with medical training", each "a lengthy (5-10 sentence) patient case description" in the form of an admission note. They are synthetic, not real patient records.

The multi-gigabyte ClinicalTrials.gov XML document collection distributed by the track was NOT downloaded. Judged trials are instead fetched from the live ClinicalTrials.gov API v2 (see README.md for the consequences).

## Terms of use

Neither the track pages (trec-cds.org) nor the NIST TREC data pages for the track state any licence, data-use agreement or usage restriction for the topics or qrels. No click-through, registration or agreement was required to download them. TREC's general data page (https://trec.nist.gov/data.html) likewise states no terms; only the standard NIST site links (privacy policy, disclaimer, FOIA) appear.

The applicable terms are therefore NIST's general statements:

- NIST "Copyrights" page (https://www.nist.gov/oism/copyrights): "With the exception of material marked as copyrighted, information presented on NIST sites are considered public information and may be distributed or copied. Use of appropriate byline/photo/image credits is requested."
- NIST "Copyright, Fair Use, and Licensing Statements for SRD, Data, Software, and Technical Series Publications" (https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications): non-SRD data produced by NIST employees "generally are not subject to copyright protection within the United States"; users "may improve, modify, and create derivative works of the data" and copy and distribute those works, and are asked to "explicitly acknowledge the National Institute of Standards and Technology as the source of the data" and to note any modifications.

Paraphrase: the topics and qrels are public NIST information with no usage restriction; acknowledgement of NIST (and, by convention, citation of the track overview paper) is requested.

Conclusion: offline, non-commercial research use (what this benchmark does) is permitted. Nothing prohibits storing the files locally or deriving the cancer-topic subset and structured answers from them.

Courtesy citation, as is customary for TREC collections:

- Roberts, Demner-Fushman, Voorhees, Bedrick, Hersh. "Overview of the TREC 2021 Clinical Trials Track." Proceedings of TREC 2021.
- Roberts, Demner-Fushman, Voorhees, Bedrick, Hersh. "Overview of the TREC 2022 Clinical Trials Track." Proceedings of TREC 2022.

## ClinicalTrials.gov

The judged trials are retrieved from the live ClinicalTrials.gov API v2 (https://clinicaltrials.gov/api/v2/studies). ClinicalTrials.gov's terms and conditions are at https://clinicaltrials.gov/about-site/terms-conditions; the data are U.S. government public information. The fetch is throttled to under 45 requests per minute with a descriptive User-Agent, following the same client conventions as the project's ingestion (`scripts/ingest/ctgov.ts`).

Note that the TREC collection is an April 2021 snapshot of ClinicalTrials.gov. Trials fetched today may have changed status, sites or eligibility text since the assessors judged them, and some judged NCT ids may no longer be served by the API. `data/cache/trec/studies/index.json` records which judged ids were found and which were missing.

## v7 addition: TREC Clinical Trials 2023 (checked 2026-10-19)

| File | URL | Size | MD5 |
| --- | --- | --- | --- |
| `topics2023.xml` (40 template topics, 8 disorders) | https://trec.nist.gov/data/trials/topics2023.xml | 19,307 B | `438daadef3068d3837e26e14965b18b7` |
| `qrels2023.txt` (33,870 lines) | https://trec.nist.gov/data/trials/qrels2023.txt | 636,340 B | `f0eaa370a653792af94879a1f913ff79` |

Linked from https://trec.nist.gov/data/trials2023.html; same 0/1/2 scale (not relevant / excluded / eligible). Same NIST terms as above: no licence or usage restriction stated; offline research use permitted with acknowledgement of NIST.
