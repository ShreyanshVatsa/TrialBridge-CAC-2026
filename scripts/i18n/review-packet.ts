/**
 * `npm run i18n:review-packet [-- tag ...]` writes eval/review/translations-<tag>.md: the 60 most
 * patient-facing strings (crisis, disclaimer/safety, questionnaire help and questions) with English and the
 * machine translation side by side, for a native speaker to mark OK / fix. Reads only repo files.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { en } from "../../components/i18n/en";
import { LOCALES } from "../../config/locales";
import { flatten } from "../../lib/i18n/keys";

const ROOT = path.resolve(import.meta.dirname, "../..");
const enFlat = flatten(en);
// Priority groups, in order. Plural keys are represented by their `.other` / `.one` form only.
const GROUPS: RegExp[] = [
  /crisis/i,
  /^disclaimer\./,
  /safety|emergenc|under18|aiNever|not.*(advice|medical)/i,
  /^questionnaire\.ui\.(whyAsk|why|reassure|reassureNoCount|reassureDeferred|afterEssentials|modeQuickHelp|modeThoroughHelp|nonResponseHint|notSure|skip|preferNot|doctorLater|summaryIntro|caregiverHelp|introLead|introPrivate|introFree|introTime|counterNoConflict|privacyNote|about\.)/,
  /^questionnaire\.ui\.labelFor|^questionnaire\..*\.labelFor/,
  /^chat\.(spreadQ|biomarkersQ)/,
  /^privacy\.(intro|aiBody|aiNever|browserBody)/,
  /^(questionnaire\.ui\.|results\.|landing\.(sub|promises|how)|findOut\.)/,
];

export function pickKeys(flat: Record<string, string>, n = 60): string[] {
  const out: string[] = [];
  for (const g of GROUPS) {
    for (const k of Object.keys(enFlat)) {
      if (out.length >= n) return out;
      if (g.test(k) && !out.includes(k) && k in flat && !/\.(zero|two|few|many)$/.test(k) && enFlat[k]!.length > 3) out.push(k);
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function main() {
  const tags = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const targets = LOCALES.filter((l) => l.tag !== "en" && (tags.length === 0 || tags.includes(l.tag)));
  mkdirSync(path.join(ROOT, "eval/review"), { recursive: true });
  for (const def of targets) {
    let flat: Record<string, string> = {};
    try {
      flat = JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${def.tag}.json`), "utf8"));
    } catch {}
    const keys = pickKeys(flat);
    if (keys.length === 0) continue;
    const rows = keys.map((k, i) => `| ${i + 1} | \`${k}\` | ${esc(enFlat[k]!)} | ${esc(flat[k]!)} | |`);
    const md = `# Translation review: ${def.englishName} (${def.tag}, ${def.nativeName})

Status: machine-translated, not reviewed. Reviewer: ______  Date: ______

**Instructions for the native speaker:** please read each row and write OK in the last column if the translation is accurate, natural and safe for a patient to read, or write your corrected text. Placeholders such as {count} must stay as they are. Please flag anything that sounds like a promise of eligibility or medical advice. The crisis line text (988, 911) must keep those numbers.

| # | Key | English | ${def.englishName} | OK / fix |
|---|-----|---------|------|----------|
${rows.join("\n")}
`;
    writeFileSync(path.join(ROOT, `eval/review/translations-${def.tag}.md`), md);
    console.log(`${def.tag}: ${keys.length} rows`);
  }
}
main();
