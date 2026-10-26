/**
 * Measures how many split criterion items the deterministic resolver settles (lib/match/criteria-resolve.ts) on a
 * seeded sample of real trials, for two SYNTHETIC answer sets: "full" (every question answered definitively) and
 * "unknowns" (age only; every other question "don't know"). Usage: npx tsx scripts/eval/resolve-share.ts [N] [seed]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BIOMARKERS_BY_GROUP, DEEP_BIOMARKERS_BY_GROUP } from "../../config/biomarkers";
import { getCatalog } from "../../config/questionnaire";
import { profileFromState, resolveCriteria } from "../../lib/match/criteria-resolve";
import type { QuestionnaireState } from "../../lib/types/questionnaire";
import type { TrialCard } from "../../lib/types/trial";

const N = Number(process.argv[2] ?? 300);
let seed = Number(process.argv[3] ?? 7);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const meta = JSON.parse(readFileSync("public/data/manifest.json", "utf8")) as { shardBase: string };
const dir = path.join("public", meta.shardBase.replace(/^\//, ""), "trials");
const cards: TrialCard[] = readdirSync(dir).flatMap((f) => Object.values(JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Record<string, { card: TrialCard }>).map((x) => x.card)).filter((c) => c.criteria?.length);
cards.sort((a, b) => a.id.localeCompare(b.id));
const sample: TrialCard[] = [];
const pool = [...cards];
while (sample.length < N && pool.length) sample.push(pool.splice(Math.floor(rand() * pool.length), 1)[0] as TrialCard);

function state(card: TrialCard, full: boolean): QuestionnaireState {
  const g = card.groups[0] as TrialCard["groups"][number];
  const answers: QuestionnaireState["answers"] = { cancer_type: g, age: 60, zip: "10001", travel: "100" };
  if (full) {
    const catalog = getCatalog("cancer", g);
    const sub = catalog.find((q) => q.id === "subtype");
    Object.assign(answers, {
      spread: "distant",
      disease_status: "recurrent",
      treatments: ["chemotherapy"],
      lines: "1",
      daily_activity: "0-1",
      brain_mets: "none",
      sex: card.sex === "MALE" ? "male" : "female",
      measurable: "yes",
      other_cancer: "no",
      // Health history (the resolver reads these).
      hiv: "no",
      hepatitis: "no",
      transplant: "none",
      autoimmune: "no",
      organ_problems: ["none"],
      in_other_trial: "no",
      ...(sub?.options?.[0] ? { subtype: sub.options[0].id } : {}),
      biomarkers: Object.fromEntries(BIOMARKERS_BY_GROUP[g].map((m) => [m, "negative"])),
      ...(DEEP_BIOMARKERS_BY_GROUP[g]?.length ? { deep_biomarkers: Object.fromEntries((DEEP_BIOMARKERS_BY_GROUP[g] ?? []).map((m) => [m, "negative"])) } : {}),
    });
  }
  return { v: 2, area: "cancer", mode: "thorough", answers, history: [], deferred: [], updatedAt: 0 };
}

for (const full of [true, false]) {
  const counts: Record<string, number> = {};
  let items = 0;
  for (const c of sample) {
    const p = profileFromState(state(c, full), getCatalog("cancer", c.groups[0] as TrialCard["groups"][number]));
    for (const l of resolveCriteria(c, p).labels) {
      items++;
      counts[l.label] = (counts[l.label] ?? 0) + 1;
    }
  }
  const settled = items - (counts.unknown ?? 0);
  console.log(`${full ? "full answers" : "age only   "}: ${sample.length} trials, ${items} items, settled ${settled} (${((100 * settled) / items).toFixed(1)}%)`, counts);
}
