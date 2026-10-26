/**
 * Extract the TrialGPT gold items for trials whose raw ClinicalTrials.gov text we already hold locally
 * (TREC judged-trial cache + national snapshot) into data/cache/trialgpt/overlap.json.
 *
 * Source: https://ftp.ncbi.nlm.nih.gov/pub/lu/TrialGPT/trial_info.json (1.1 GB, U.S. government work, public domain;
 * TrialGPT, Jin et al., Nature Communications 2024). Download it to data/cache/trialgpt/trial_info.json first:
 *   curl -o data/cache/trialgpt/trial_info.json https://ftp.ncbi.nlm.nih.gov/pub/lu/TrialGPT/trial_info.json
 * The file is too large for JSON.parse, so this scans it once and parses only the wanted per-trial objects.
 *
 * Usage: npx tsx scripts/eval/trialgpt/extract.ts
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TRIALGPT_DIR = "data/cache/trialgpt";
export const OVERLAP_FILE = path.join(TRIALGPT_DIR, "overlap.json");

export interface OverlapTrial {
  source: "trec" | "national";
  raw: string;
  gold: { inclusion: string; exclusion: string };
}

/** NCT id -> raw eligibilityCriteria from the local CT.gov caches. */
export function localRawTexts(): Map<string, { source: OverlapTrial["source"]; raw: string }> {
  const out = new Map<string, { source: OverlapTrial["source"]; raw: string }>();
  const dirs: [OverlapTrial["source"], string, RegExp][] = [
    ["trec", "data/cache/trec/studies", /^batch-\d+\.json$/],
    ["national", "data/cache/national", /^page-\d+\.json$/],
  ];
  for (const [source, dir, re] of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => re.test(x)).sort()) {
      const page = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { studies?: unknown[] } | unknown[];
      const studies = (Array.isArray(page) ? page : page.studies ?? []) as { protocolSection?: { identificationModule?: { nctId?: string }; eligibilityModule?: { eligibilityCriteria?: string } } }[];
      for (const s of studies) {
        const id = s.protocolSection?.identificationModule?.nctId;
        const raw = s.protocolSection?.eligibilityModule?.eligibilityCriteria;
        if (id && raw && !out.has(id)) out.set(id, { source, raw });
      }
    }
  }
  return out;
}

function main(): void {
  const src = path.join(TRIALGPT_DIR, "trial_info.json");
  if (!existsSync(src)) throw new Error(`${src} missing; see the header of this file for the download command`);
  const want = localRawTexts();
  const buf = readFileSync(src);
  const dec = new TextDecoder();
  const out: Record<string, OverlapTrial> = {};
  // Depth-1 keys are NCT ids; scan bytes tracking strings/escapes and brace depth.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let keyStart = -1;
  let objStart = -1;
  let curKey = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i] as number;
    if (inStr) {
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) {
        inStr = false;
        if (depth === 1 && keyStart >= 0) {
          curKey = dec.decode(buf.subarray(keyStart, i));
          keyStart = -1;
        }
      }
      continue;
    }
    if (c === 0x22) {
      inStr = true;
      if (depth === 1 && objStart < 0) keyStart = i + 1;
    } else if (c === 0x7b) {
      depth++;
      if (depth === 2) objStart = i;
    } else if (c === 0x7d) {
      if (depth === 2 && objStart >= 0) {
        const hit = want.get(curKey);
        if (hit) {
          const o = JSON.parse(dec.decode(buf.subarray(objStart, i + 1))) as { inclusion_criteria?: string; exclusion_criteria?: string };
          out[curKey] = { source: hit.source, raw: hit.raw, gold: { inclusion: o.inclusion_criteria ?? "", exclusion: o.exclusion_criteria ?? "" } };
        }
        objStart = -1;
      }
      depth--;
    }
  }
  writeFileSync(OVERLAP_FILE, JSON.stringify(out));
  const n = Object.values(out);
  console.log(`local raw texts ${want.size}; overlap with TrialGPT ${n.length} (trec ${n.filter((x) => x.source === "trec").length}, national ${n.filter((x) => x.source === "national").length}) -> ${OVERLAP_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
