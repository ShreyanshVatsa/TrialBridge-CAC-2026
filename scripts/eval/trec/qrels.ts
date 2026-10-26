/** TREC qrels parsing: `topic 0 NCTid grade` per line, grade 0 = not relevant, 1 = excluded, 2 = eligible. */
import { readFileSync } from "node:fs";

export type Grade = 0 | 1 | 2;
export type TopicQrels = Record<string, Grade>;

export function parseQrels(text: string): Map<number, TopicQrels> {
  const out = new Map<number, TopicQrels>();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length !== 4) throw new Error(`bad qrels line: ${line}`);
    const topic = Number(parts[0]);
    const nct = parts[2] ?? "";
    const grade = Number(parts[3]);
    if (!Number.isInteger(topic) || !/^NCT\d{8}$/.test(nct) || ![0, 1, 2].includes(grade)) throw new Error(`bad qrels line: ${line}`);
    let byNct = out.get(topic);
    if (!byNct) {
      byNct = {};
      out.set(topic, byNct);
    }
    byNct[nct] = grade as Grade;
  }
  return out;
}

export function readQrels(file: string): Map<number, TopicQrels> {
  return parseQrels(readFileSync(file, "utf8"));
}
