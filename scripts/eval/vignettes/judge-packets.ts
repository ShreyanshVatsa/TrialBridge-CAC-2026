/**
 * Blind judging packets for the vignette benchmark: `npx tsx scripts/eval/vignettes/judge-packets.ts [--split=dev|test]`.
 * One markdown file per vignette in data/cache/judge-packets/: the patient and every pooled trial with numbered
 * criteria. Trials are in a hash order that carries no information about which system retrieved them or at what rank.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadNational } from "../national";
import { judgingPool, readPool } from "./pool";
import { PACKETS_DIR, readVignettes } from "./files";
import { INSTRUCTIONS, packetTrial, patientText, type Packet, type PacketTrial } from "./judge-prompt";

const h = (s: string) => createHash("sha1").update(s).digest("hex");

export function buildPackets(split?: "dev" | "test"): Packet[] {
  const pool = readPool();
  if (!pool) throw new Error("run pool.ts first");
  const national = loadNational();
  if (!national) throw new Error("national data not found");
  return readVignettes(undefined, split).map((v) => {
    const ids = judgingPool(pool, v.id).sort((a, b) => h(`${v.id}:${a}`).localeCompare(h(`${v.id}:${b}`)));
    const trials = ids.map((id) => {
      const t = national.trial(id);
      if (!t) throw new Error(`${id} missing from national data`);
      return packetTrial(t.card);
    });
    return { vignette: v.id, patient: patientText(v), trials };
  });
}

function renderTrial(t: PacketTrial, i: number): string {
  const age = `${t.minAge ?? "any"}-${t.maxAge ?? "any"}`;
  const crit = (s: "I" | "E", list: { n: number; text: string }[]) => list.map((c) => `  ${s}${c.n}. ${c.text}`).join("\n") || "  (none listed)";
  return `### Trial ${i + 1}: ${t.id}\nTitle: ${t.title}\nConditions: ${t.conditions.join("; ") || "n/a"}\nPhases: ${t.phases.join(", ") || "n/a"}; ages ${age}; sex ${t.sex}\nINCLUSION (section "inclusion"; I<n> = criterion n):\n${crit("I", t.inclusion)}\nEXCLUSION (section "exclusion"; E<n> = criterion n):\n${crit("E", t.exclusion)}\n`;
}

export function renderPacket(p: Packet): string {
  return `# Patient ${p.vignette}\n\n${p.patient}\n\n# ${p.trials.length} trials to judge\n\n${p.trials.map(renderTrial).join("\n")}`;
}

export const CHUNK_CHARS = 70_000;
export const CHUNK_TRIALS = 20;
export interface Chunk {
  id: string;
  vignette: string;
  trialIds: string[];
  chars: number;
}

/** Split a packet into chunks small enough for one judge read (<= CHUNK_CHARS and <= CHUNK_TRIALS trials). */
export function chunkPacket(p: Packet): { chunk: Chunk; packet: Packet }[] {
  const groups: PacketTrial[][] = [[]];
  let chars = 0;
  for (const t of p.trials) {
    const c = renderTrial(t, 0).length;
    const cur = groups[groups.length - 1] as PacketTrial[];
    if (cur.length > 0 && (cur.length >= CHUNK_TRIALS || chars + c > CHUNK_CHARS)) {
      groups.push([]);
      chars = 0;
    }
    (groups[groups.length - 1] as PacketTrial[]).push(t);
    chars += c;
  }
  return groups.map((trials, k) => {
    const packet = { ...p, trials };
    return { chunk: { id: `${p.vignette}-${k + 1}`, vignette: p.vignette, trialIds: trials.map((t) => t.id), chars: renderPacket(packet).length }, packet };
  });
}

export function readChunkIndex(): Chunk[] {
  return JSON.parse(readFileSync(`${PACKETS_DIR}/index.json`, "utf8")) as Chunk[];
}

if (process.argv[1]?.endsWith("judge-packets.ts")) {
  const arg = process.argv.find((a) => a.startsWith("--split="))?.slice(8) as "dev" | "test" | undefined;
  mkdirSync(PACKETS_DIR, { recursive: true });
  const index: Chunk[] = [];
  for (const p of buildPackets(arg)) for (const { chunk, packet } of chunkPacket(p)) {
    writeFileSync(`${PACKETS_DIR}/${chunk.id}.md`, renderPacket(packet));
    index.push(chunk);
  }
  writeFileSync(`${PACKETS_DIR}/index.json`, JSON.stringify(index));
  writeFileSync(`${PACKETS_DIR}/INSTRUCTIONS.md`, INSTRUCTIONS);
  console.log(`${index.length} chunks (${arg ?? "all"}); trials ${index.reduce((a, c) => a + c.trialIds.length, 0)}; chars mean ${Math.round(index.reduce((a, c) => a + c.chars, 0) / index.length)}, max ${Math.max(...index.map((c) => c.chars))}`);
}
