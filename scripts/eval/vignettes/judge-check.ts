/**
 * Check judge output: `npx tsx scripts/eval/vignettes/judge-check.ts --judge=judge-a [--split=dev|test] [--ids=v001,v002]`.
 * For every chunk of the split: the file eval/gold/judgments/<judge>/<chunk>.json must parse, cover exactly the chunk's
 * trials, and every evidence quote must be a verbatim substring of the numbered criterion it cites (verifyJudgment).
 * Valid files are normalised to the JudgmentFile shape (an existing judgedAt is kept; a file is rewritten only when its
 * normalised content differs). Prints the chunks still missing or invalid (the redo list).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadNational } from "../national";
import { JUDGMENTS_DIR } from "./files";
import { readChunkIndex } from "./judge-packets";
import { JudgmentSchema, packetTrial, verifyJudgment, type Judgment, type JudgmentFile, type PacketTrial } from "./judge-prompt";
import { splitOf } from "./schema";

export const MODELS_BY_JUDGE: Record<string, string> = { "judge-a": "labeling pass A", "judge-b": "labeling pass B (independent)" };

export interface ChunkCheck {
  chunk: string;
  status: "ok" | "missing" | "invalid";
  problems: string[];
}

export function checkJudge(judge: string, split?: "dev" | "test", only?: Set<string>): { checks: ChunkCheck[]; labels: Map<string, Judgment[]> } {
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  const trialCache = new Map<string, PacketTrial>();
  const trial = (id: string) => {
    let t = trialCache.get(id);
    if (!t) {
      const x = national.trial(id);
      if (x) trialCache.set(id, (t = packetTrial(x.card)));
    }
    return t;
  };
  const checks: ChunkCheck[] = [];
  const labels = new Map<string, Judgment[]>();
  for (const c of readChunkIndex()) {
    if (split && splitOf(c.vignette) !== split) continue;
    if (only && !only.has(c.vignette)) continue;
    const file = `${JUDGMENTS_DIR}/${judge}/${c.id}.json`;
    if (!existsSync(file)) {
      checks.push({ chunk: c.id, status: "missing", problems: [] });
      continue;
    }
    const problems: string[] = [];
    let raw: { labels?: unknown[]; judgedAt?: unknown } = {};
    const text = readFileSync(file, "utf8");
    try {
      raw = JSON.parse(text) as { labels?: unknown[]; judgedAt?: unknown };
    } catch (e) {
      problems.push(`unparseable JSON: ${(e as Error).message}`);
    }
    const parsed: Judgment[] = [];
    (Array.isArray(raw.labels) ? raw.labels : []).forEach((l, i) => {
      const r = JudgmentSchema.safeParse(l);
      if (r.success) parsed.push(r.data);
      else problems.push(`entry ${i}: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ").slice(0, 160)}`);
    });
    const want = new Set(c.trialIds);
    const got = new Set(parsed.map((j) => j.nctId));
    for (const id of want) if (!got.has(id)) problems.push(`${id}: not judged`);
    if (got.size !== parsed.length) problems.push("duplicate nctId");
    for (const j of parsed) {
      if (!want.has(j.nctId)) problems.push(`${j.nctId}: not in chunk`);
      else problems.push(...verifyJudgment(j, trial(j.nctId)));
    }
    if (problems.length === 0) {
      const judgedAt = typeof raw.judgedAt === "string" ? raw.judgedAt : new Date().toISOString().slice(0, 10);
      const out: JudgmentFile = { judge, model: MODELS_BY_JUDGE[judge] ?? judge, vignette: c.vignette, judgedAt, labels: parsed };
      const normalised = `${JSON.stringify(out)}\n`;
      if (normalised !== text) writeFileSync(file, normalised);
      labels.set(c.id, parsed);
    }
    checks.push({ chunk: c.id, status: problems.length ? "invalid" : "ok", problems });
  }
  return { checks, labels };
}

if (process.argv[1]?.endsWith("judge-check.ts")) {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const judge = arg("judge");
  if (!judge) throw new Error("usage: judge-check.ts --judge=<judge-a|judge-b> [--split=dev|test] [--ids=v001,...]");
  const only = arg("ids") ? new Set(arg("ids")!.split(",")) : undefined;
  const { checks } = checkJudge(judge, arg("split") as "dev" | "test" | undefined, only);
  const n = (s: string) => checks.filter((c) => c.status === s).length;
  console.log(`${judge}: ${n("ok")} ok, ${n("invalid")} invalid, ${n("missing")} missing of ${checks.length} chunks`);
  for (const c of checks.filter((x) => x.status === "invalid")) console.log(`  INVALID ${c.chunk}: ${c.problems.slice(0, 4).join(" | ")}${c.problems.length > 4 ? ` (+${c.problems.length - 4})` : ""}`);
  const miss = checks.filter((c) => c.status === "missing").map((c) => c.chunk);
  if (miss.length) console.log(`  missing: ${miss.slice(0, 40).join(" ")}${miss.length > 40 ? " ..." : ""}`);
}
