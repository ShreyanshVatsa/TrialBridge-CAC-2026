/** File locations and readers for the vignette benchmark. */
import { readFileSync } from "node:fs";
import { VignetteFileSchema, splitOf, type Vignette } from "./schema";

export const VIGNETTES_FILE = "eval/gold/vignettes-v1.json";
export const JUDGMENTS_DIR = "eval/gold/judgments";
export const PACKETS_DIR = "data/cache/judge-packets";

/** Extra answers per vignette, kept outside the frozen vignette file (`--answers=<tag>` reads this pattern). */
export const answersFile = (tag: string) => `eval/gold/vignettes-answers-${tag}.json`;

/**
 * Vignettes of the frozen file, optionally restricted to one split. With `answersTag` the answers in
 * eval/gold/vignettes-answers-<tag>.json ({ vignettes: { id: { questionId: value } } }) are merged over each vignette's
 * own answers; the frozen file is never rewritten.
 */
export function readVignettes(file: string = VIGNETTES_FILE, split?: "dev" | "test", answersTag?: string): Vignette[] {
  const all = VignetteFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).vignettes;
  const extra = answersTag ? (JSON.parse(readFileSync(answersFile(answersTag), "utf8")) as { vignettes: Record<string, Vignette["answers"]> }).vignettes : {};
  const merged = answersTag ? all.map((v) => ({ ...v, answers: { ...v.answers, ...(extra[v.id] ?? {}) } })) : all;
  return split ? merged.filter((v) => splitOf(v.id) === split) : merged;
}
