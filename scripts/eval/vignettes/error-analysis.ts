/**
 * Error analysis for the vignette benchmark (dev split only unless --split=test is passed, which it never should be
 * while tuning): why do gold-"excluded" trials sit in the top 10, and where do the gold-"eligible" trials rank?
 *
 * `npx tsx scripts/eval/vignettes/error-analysis.ts [--split=dev] [--system=pipeline:v7+resolver] [--live]`
 *
 * For every top-10 trial the gold labels "excluded", the primary judge's `not_met` evidence is mapped to the split
 * criterion item it quotes, the deterministic resolver is run on that item with the vignette's answers, and the case
 * is put in one bucket:
 *   tier_b_shown        the resolver already failed the trial (Tier B) and it still shows in the top 10
 *   resolver_gap        the item carries a directional fact the answers could settle, but the resolver left it unknown
 *   extractor_gap       no usable fact was extracted although the criterion is about a questionnaire topic
 *   free_text_only      the judge's reason rests on detail the questionnaire does not ask (drug names, dates, labs...)
 *   no_answer           the question exists but the vignette answered unknown / did not answer
 * With --live the current pipeline is re-run (rankTrials + resolver) instead of the stored pool ranking. --depth=50 looks
 * at the top 50 instead of the top 10; --buckets=<file> writes the per-pair bucket and topic map that diagnose.ts reads.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { factPolicy } from "../../../config/questionnaire/fact-policy";
import { factsForCriterion } from "../../../lib/ingest/facts";
import { normalizeMarkers, profileFromState, resolveItem, type ResolverProfile } from "../../../lib/match/criteria-resolve";
import { resolveRanking } from "../../../lib/match/criteria-rank";
import { TOP_N } from "../../../lib/match/rank";
import type { SplitCriterion } from "../../../lib/ingest/criteria-split";
import { loadNational } from "../national";
import type { GoldFile } from "./build-gold";
import { GOLD_FILE } from "./build-gold";
import { JUDGMENTS_DIR, readVignettes } from "./files";
import type { JudgmentFile } from "./judge-prompt";
import { readPool } from "./pool";
import { vignetteState } from "./schema";
import { pipelineRanking, queryVectors, vignetteContexts } from "./systems";
import { readdirSync } from "node:fs";

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string | undefined]));
const split = (args.get("split") ?? "dev") as "dev" | "test";
if (split === "test") throw new Error("error analysis runs on dev only");
const system = args.get("system") ?? "pipeline:v7+resolver";
const live = args.has("live");
const maxExamples = Number(args.get("examples") ?? 12);
const depth = Number(args.get("depth") ?? 10);
const bucketsOut = args.get("buckets");
const pairBuckets: Record<string, { bucket: Bucket; topic: string }> = {};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

type Bucket = "tier_b_shown" | "resolver_gap" | "extractor_gap" | "free_text_only" | "no_answer" | "no_evidence";
const TOPICS: [RegExp, string][] = [
  [/\b(?:ecog|karnofsky|performance status|kps)\b/i, "performance"],
  [/\b(?:brain|cns|leptomeningeal)\b/i, "brain_mets"],
  [/\bmeasurable\b/i, "measurable"],
  [/\b(?:lines?|regimens?) of\b|\bprior (?:lines?|regimens?|systemic)|\bfirst[- ]line|\bsecond[- ]line|\bline(?:s)? of (?:therapy|treatment)|\bno (?:prior|previous) (?:systemic|chemotherapy|treatment|therapy)|\bpreviously (?:un)?treated|\btreatment[- ]na[iï]ve|\bnewly diagnosed/i, "lines_or_treated"],
  [/\b(?:her2|hr[+-]|er[+-]|estrogen|progesterone|egfr|alk|ros1|kras|braf|pd-?l1|brca|msi|dmmr|mmr|ntrk|flt3|met\b|ret\b|npm1|tp53|mgmt|idh|pik3ca|esr1|palb2|kit\b|cldn18|hpv|bcr-abl|philadelphia|triple[- ]negative|tnbc|hormone receptor|mutation|amplification|fusion|rearrangement)\b/i, "biomarker"],
  [/\b(?:metastatic|stage (?:i{1,3}|iv|[1-4])|locally advanced|unresectable|resectable|adjuvant|neoadjuvant|recurrent|relapsed|refractory|castration|platinum|muscle[- ]invasive|non-?muscle)\b/i, "stage_or_status"],
  [/\b(?:adenocarcinoma|squamous|small cell|non-small|nsclc|sclc|ductal|lobular|glioblastoma|astrocytoma|oligodendroglioma|carcinoma|histolog|subtype|follicular|diffuse large|hodgkin|mantle|marginal|myeloid|lymphoblastic|lymphocytic|multiple myeloma|melanoma|sarcoma|renal cell|urothelial|hepatocellular|cholangio|papillary|medullary|anaplastic|serous|endometri|cervical|gastric|esophageal)\b/i, "histology"],
  [/\b(?:prior|previous(?:ly)?|received|treated with)\b.*\b(?:inhibitor|antibody|anti-|mab\b|nib\b|chemotherapy|immunotherapy|checkpoint|endocrine|tamoxifen|letrozole|anastrozole|fulvestrant|palbociclib|cdk4|trastuzumab|pertuzumab|osimertinib|pembrolizumab|nivolumab|platinum|taxane|radiation|radiotherapy|surgery|transplant)/i, "prior_drug"],
  [/\b(?:hiv|hepatitis|hbv|hcv|autoimmune|transplant|kidney|renal|liver|hepatic|cardiac|heart|pregnan|breastfeed|another (?:clinical )?(?:trial|study)|second (?:primary )?malignancy|other malignanc|prior malignanc)\b/i, "health_history"],
  [/\b(?:anc|platelet|hemoglobin|creatinine|bilirubin|ast|alt|lvef|qtc|egfr\s*[<>]|laboratory|lab values|adequate (?:organ|bone marrow|renal|hepatic))\b/i, "labs"],
  [/\b(?:age|years old|≥ ?18|>= ?18)\b/i, "age"],
  [/\b(?:female|male|women|men)\b/i, "sex"],
];
const topicOf = (quote: string, item?: SplitCriterion) => TOPICS.find(([re]) => re.test(item?.text ?? quote))?.[1] ?? "other";

function findItem(criteria: readonly SplitCriterion[], section: "inclusion" | "exclusion", quote: string): SplitCriterion | undefined {
  const q = norm(quote);
  return criteria.find((c) => c.section === section && norm(c.text).includes(q));
}

/** The profile fields a fact key would need, and whether the profile has them. */
function profileHas(key: string, p: ResolverProfile): boolean | null {
  if (key === "ecog_max") return p.ecog !== undefined;
  if (key === "min_prior_lines" || key === "max_prior_lines") return p.lines !== undefined;
  if (key === "previously_treated" || key === "newly_diagnosed") return p.treated !== undefined;
  if (key === "brain_mets") return p.brainMets !== undefined;
  if (key === "measurable_disease") return p.measurable !== undefined;
  if (key === "other_malignancy") return p.otherCancer !== undefined;
  if (key.startsWith("biomarker:")) return p.biomarkers?.[key.slice(10) as keyof NonNullable<typeof p.biomarkers>] !== undefined;
  if (key.startsWith("histology:")) return p.histologyIs !== undefined;
  if (["hiv", "hepatitis_b", "hepatitis_c", "organ_transplant", "allo_sct", "autoimmune", "kidney_disease", "liver_disease", "heart_disease", "pregnancy", "concurrent_trial"].includes(key)) return true;
  if (key === "metastatic" || key === "locally_advanced" || key === "adjuvant_setting" || key === "resectable") return null; // stage: no resolver field
  return null;
}

async function main(): Promise<void> {
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  const pool = readPool();
  if (!pool) throw new Error("pool missing");
  const gold = JSON.parse(readFileSync(GOLD_FILE, "utf8")) as GoldFile;
  const vignettes = readVignettes(undefined, split, args.get("answers")).filter((v) => gold.vignettes[v.id]);
  const ctxs = vignetteContexts(vignettes, national);
  const qs = live ? await queryVectors(ctxs) : [];
  const judge = new Map<string, Map<string, JudgmentFile["labels"][number]>>();
  for (const f of readdirSync(`${JUDGMENTS_DIR}/judge-a`)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(`${JUDGMENTS_DIR}/judge-a/${f}`, "utf8")) as JudgmentFile;
    const m = judge.get(j.vignette) ?? new Map();
    for (const l of j.labels) m.set(l.nctId, l);
    judge.set(j.vignette, m);
  }

  const buckets: Record<Bucket, number> = { tier_b_shown: 0, resolver_gap: 0, extractor_gap: 0, free_text_only: 0, no_answer: 0, no_evidence: 0 };
  const topics: Record<string, Record<string, number>> = {};
  const resolverGapKeys: Record<string, number> = {};
  const examples: Record<Bucket, string[]> = { tier_b_shown: [], resolver_gap: [], extractor_gap: [], free_text_only: [], no_answer: [], no_evidence: [] };
  let excludedTop10 = 0;
  let top10Total = 0;
  const eligRanks: number[] = [];
  let eligTotal = 0;
  let tierBInTop10 = 0;
  const topicCounts: Record<string, number> = {};

  ctxs.forEach((ctx, i) => {
    const v = ctx.vignette;
    const labels = gold.vignettes[v.id] ?? {};
    let ranked: string[];
    let byTrialTier: Record<string, "A" | "B"> = {};
    if (live) {
      const ids = pipelineRanking(ctx, qs[i] as Float32Array, 50);
      const byId = new Map(ctx.candidates.map((c) => [c.card.id, c] as const));
      const head = ids.slice(0, TOP_N).map((id) => byId.get(id)!);
      const r = resolveRanking(head, ctx.answers, ctx.catalog);
      ranked = [...r.order, ...ids.slice(TOP_N)];
      byTrialTier = Object.fromEntries(Object.entries(r.byTrial).map(([id, t]) => [id, t.score.tier]));
    } else {
      ranked = pool.rankings[v.id]?.[system] ?? [];
      const byId = new Map(ctx.candidates.map((c) => [c.card.id, c] as const));
      const head = ranked.slice(0, TOP_N).map((id) => byId.get(id)).filter((x) => x !== undefined);
      const r = resolveRanking(head, ctx.answers, ctx.catalog);
      byTrialTier = Object.fromEntries(Object.entries(r.byTrial).map(([id, t]) => [id, t.score.tier]));
    }
    const profile = profileFromState(vignetteState(v), ctx.catalog);
    const top10 = ranked.slice(0, depth);
    top10Total += top10.length;
    for (const [id, l] of Object.entries(labels)) {
      if (l.l !== "eligible") continue;
      eligTotal++;
      const r = ranked.indexOf(id);
      eligRanks.push(r < 0 ? 999 : r + 1);
    }
    for (const id of top10) {
      if (labels[id]?.l !== "excluded") continue;
      excludedTop10++;
      if (byTrialTier[id] === "B") tierBInTop10++;
      const trial = national.trial(id);
      const j = judge.get(v.id)?.get(id);
      const criteria = trial?.card.criteria ?? [];
      const ev = (j?.evidence ?? []).filter((e) => e.verdict === "not_met");
      if (!trial || ev.length === 0) {
        buckets.no_evidence++;
        continue;
      }
      let bucket: Bucket | null = null;
      let topic = "other";
      let detail = "";
      if (byTrialTier[id] === "B") bucket = "tier_b_shown";
      for (const e of ev) {
        const item = findItem(criteria, e.section, e.quote);
        topic = topicOf(e.quote, item);
        if (bucket) break;
        if (!item) {
          detail = `no split item for "${e.quote.slice(0, 60)}"`;
          continue;
        }
        const label = resolveItem(item, profile, { groups: trial.card.groups, conditions: trial.card.conditions });
        const facts = factsForCriterion(item.section, normalizeMarkers(item.text), { v2: true, groups: trial.card.groups, conditions: trial.card.conditions }).filter((f) => f.value !== "mentioned");
        const settleable = facts.filter((f) => profileHas(f.key, profile) === true);
        const unanswered = facts.filter((f) => profileHas(f.key, profile) === false);
        if (label.label === "not_met" || label.label === "excluded") {
          bucket = "tier_b_shown";
          detail = `${item.id} ${label.label}`;
        } else if (settleable.length) {
          bucket = "resolver_gap";
          for (const f of settleable) resolverGapKeys[f.key] = (resolverGapKeys[f.key] ?? 0) + 1;
          detail = `${item.id} unknown (${label.reason}) facts ${settleable.map((f) => `${f.key}=${f.value}${f.param !== undefined ? `/${String(f.param)}` : ""}${factPolicy(f.key).penalize && !factPolicy(f.key).belowGate ? "" : " [gated]"}`).join(", ")}: ${item.text.slice(0, maxExamples > 12 ? 400 : 120)}`;
        } else if (unanswered.length) {
          bucket = "no_answer";
          detail = `${item.id} facts ${unanswered.map((f) => f.key).join(", ")} unanswered`;
        } else if (["performance", "brain_mets", "measurable", "lines_or_treated", "biomarker", "histology", "stage_or_status", "health_history", "age", "sex"].includes(topic)) {
          bucket = "extractor_gap";
          detail = `${item.id} no fact (${topic}): ${item.text.slice(0, maxExamples > 12 ? 400 : 140)}`;
        } else {
          bucket = "free_text_only";
          detail = `${item.id} (${topic}): ${item.text.slice(0, 120)}`;
        }
        break;
      }
      bucket ??= "free_text_only";
      buckets[bucket]++;
      pairBuckets[`${v.id}|${id}`] = { bucket, topic };
      topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
      (topics[bucket] ??= {})[topic] = (topics[bucket]?.[topic] ?? 0) + 1;
      if (examples[bucket].length < maxExamples) examples[bucket].push(`${v.id} ${id} ${detail}`);
    }
  });

  if (bucketsOut) writeFileSync(bucketsOut, JSON.stringify(pairBuckets));
  console.log(`${split}: ${ctxs.length} vignettes, system ${live ? "live pipeline" : system}`);
  console.log(`top-10 slots ${top10Total}, gold-excluded in top 10: ${excludedTop10} (${((100 * excludedTop10) / top10Total).toFixed(1)}%), of which already Tier B: ${tierBInTop10}`);
  console.log("buckets:", buckets);
  console.log("topic of the judge's not_met evidence (all excluded-in-top-10):", topicCounts);
  for (const [b, t] of Object.entries(topics)) console.log(`  ${b}:`, t);
  console.log("resolver_gap fact keys:", resolverGapKeys);
  const within = (k: number) => eligRanks.filter((r) => r <= k).length;
  console.log(`gold-eligible trials: ${eligTotal}; in top 10: ${within(10)}, top 15: ${within(15)}, top 50: ${within(50)}, not in list: ${eligRanks.filter((r) => r === 999).length}`);
  for (const [b, ex] of Object.entries(examples)) {
    console.log(`\n## ${b}`);
    for (const e of ex) console.log("- " + e);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
