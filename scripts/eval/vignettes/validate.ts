/** Validate vignette files: `npx tsx scripts/eval/vignettes/validate.ts eval/gold/vignettes-v1.json [more files]`. */
import { readFileSync } from "node:fs";
import { VignetteFileSchema, splitOf, vignetteProblems } from "./schema";

let bad = 0;
const seen = new Set<string>();
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: validate.ts <file.json> [...]");
  process.exit(2);
}
const counts: Record<string, { dev: number; test: number }> = {};
for (const file of files) {
  const parsed = VignetteFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    console.error(`${file}: schema errors\n${parsed.error.issues.slice(0, 20).map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
    bad++;
    continue;
  }
  for (const v of parsed.data.vignettes) {
    if (seen.has(v.id)) {
      console.error(`${file} ${v.id}: duplicate id`);
      bad++;
    }
    seen.add(v.id);
    const problems = vignetteProblems(v);
    if (problems.length) {
      bad++;
      console.error(`${file} ${v.id} (${v.group}): ${problems.join("; ")}`);
    }
    const c = (counts[v.group] ??= { dev: 0, test: 0 });
    c[splitOf(v.id)]++;
  }
}
console.log(`${seen.size} vignettes; per group (dev/test): ${Object.entries(counts).map(([g, c]) => `${g} ${c.dev}/${c.test}`).join(", ")}`);
if (bad) {
  console.error(`${bad} problem(s)`);
  process.exit(1);
}
console.log("ok");
