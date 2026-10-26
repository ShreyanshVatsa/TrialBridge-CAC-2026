/**
 * The ClinicalTrials.gov API as an independent retrieval system for the vignette pool: the site's own search
 * (query.cond = the cancer group, query.term = the profile's English terms, recruiting + interventional + U.S.),
 * restricted to trials in our dataset. Results are cached by query in data/cache/vignette-ctgov.json. Only synthetic
 * vignette text is ever sent (never patient data).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCancerGroup } from "../../../config/cancer-groups";
import { SCOPE_PARAMS } from "../../ingest/ctgov";
import type { VignetteContext } from "./systems";

const CACHE = "data/cache/vignette-ctgov.json";
const BASE = "https://clinicaltrials.gov/api/v2/studies";
const USER_AGENT = "TrialBridge-eval/0.1 (benchmark pooling; open data use)";
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STOP = new Set(["and", "the", "with", "for", "of", "prior", "previously", "treated", "therapy", "treatment", "lines", "line", "two", "one", "newly", "diagnosed", "disease", "measurable", "positive", "negative"]);
/** Essie rejects long free-text terms ("Too complicated query"); OR together the first `maxWords` distinctive words (an AND of all of them returns almost nothing). */
function queryFor(ctx: VignetteContext, maxWords = 8): Record<string, string> {
  const v = ctx.vignette;
  const cond = v.group === "other" ? "cancer" : getCancerGroup(v.group).label.replace(/ and .*$/, "");
  // Profile terms minus the group label and synonym sentences; plain words only (Essie rejects some punctuation),
  // capped so the site's search is not over-constrained.
  const sentences = ctx.queryText.split(/(?<=\.)\s+/);
  const term = sentences
    .slice(v.group === "other" ? 1 : 2)
    .join(" ")
    .replace(/[^A-Za-z0-9+\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w, i, a) => w.length > 2 && !STOP.has(w.toLowerCase()) && a.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i)
    .slice(0, maxWords)
    .join(" OR ");
  return { ...SCOPE_PARAMS, "query.cond": cond, ...(term ? { "query.term": term } : {}), pageSize: "50", fields: "protocolSection.identificationModule.nctId", format: "json" };
}

export async function ctgovRankings(ctxs: readonly VignetteContext[]): Promise<Map<string, string[]>> {
  const cache: Record<string, string[]> = existsSync(CACHE) ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, string[]>) : {};
  const out = new Map<string, string[]>();
  let fetched = 0;
  for (const ctx of ctxs) {
    let maxWords = 8;
    let params = queryFor(ctx, maxWords);
    let key = new URLSearchParams(params).toString();
    while (!cache[key]) {
      const wait = last + 1400 - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let ids: string[] | null = null;
      let retry = false;
      for (let attempt = 0; attempt < 4 && !ids; attempt++) {
        try {
          const res = await fetch(`${BASE}?${key}`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
          if (res.ok) {
            const data = (await res.json()) as { studies?: { protocolSection?: { identificationModule?: { nctId?: string } } }[] };
            ids = (data.studies ?? []).map((s) => s.protocolSection?.identificationModule?.nctId ?? "").filter(Boolean);
          } else if (res.status === 400 && maxWords > 3) {
            maxWords = Math.floor(maxWords / 2);
            params = queryFor(ctx, maxWords);
            key = new URLSearchParams(params).toString();
            retry = true;
            break;
          } else if (res.status < 500 && res.status !== 429) throw new Error(`CT.gov HTTP ${res.status} for ${key}`);
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("CT.gov HTTP")) throw err;
        }
        if (!ids) await sleep(2000 * 2 ** attempt);
      }
      if (retry) continue;
      cache[key] = ids ?? [];
      fetched++;
      mkdirSync(path.dirname(CACHE), { recursive: true });
      writeFileSync(CACHE, JSON.stringify(cache));
    }
    const inSet = new Set(ctx.candidates.map((c) => c.card.id));
    out.set(ctx.vignette.id, (cache[key] ?? []).filter((id) => inSet.has(id)));
  }
  if (fetched) console.log(`ctgov: ${fetched} queries fetched, ${ctxs.length - fetched} cached`);
  return out;
}
