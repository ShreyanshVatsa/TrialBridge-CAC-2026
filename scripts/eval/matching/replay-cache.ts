/**
 * Replay every cached judge completion (data/cache/matching-llm) through the production parser.
 * The request bodies are not cached (only their hash), so this checks the parse step only: a completion is "ok"
 * when parseMatchJson accepts it and it names at least one trial with at least one item.
 *
 * Usage: npx tsx scripts/eval/matching/replay-cache.ts [--verbose]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseMatchJson } from "../../../functions/lib/ai/match-output";

const dir = path.join(process.cwd(), "data/cache/matching-llm");
const verbose = process.argv.includes("--verbose");
let ok = 0;
let empty = 0;
const rejected: string[] = [];
for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
  const rec = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { status: number; body: string };
  if (rec.status !== 200) continue;
  const content = (JSON.parse(rec.body) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";
  try {
    const out = parseMatchJson(content);
    const items = out.trials.reduce((s, t) => s + t.items.length, 0);
    if (items === 0) {
      empty++;
      if (verbose) console.log(`empty    ${f}`);
    } else {
      ok++;
      if (verbose) console.log(`ok       ${f} trials=${out.trials.length} items=${items}`);
    }
  } catch (err) {
    rejected.push(f);
    if (verbose) console.log(`rejected ${f} ${(err as Error).message}`);
  }
}
console.log(`completions ${ok + empty + rejected.length}: ok ${ok}, empty ${empty}, rejected ${rejected.length}`);
for (const f of rejected) console.log(`  rejected ${f}`);
process.exitCode = rejected.length > 0 ? 1 : 0;
