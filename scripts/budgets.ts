/**
 * `npm run budgets` (after `npm run build`): hold the shipped bytes to perf/budgets.json.
 *  - route JS (gzip) per page: every <script src> the page's HTML references, deduplicated;
 *  - shard download (gzip) per cancer group: the sum of its shard files, from the data in out/data;
 *  - the largest single asset (Cloudflare refuses assets over 25 MiB) and the total file count;
 *  - the cold-search download: model + ORT wasm + the largest group's shards.
 * Prints a table and exits 1 when any measured value exceeds its budget. `--write` records the measured values as
 * the new budgets (with the configured headroom) for a deliberate re-baseline.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ManifestSchema } from "../lib/types/trial";

const OUT = "out";
const BUDGETS = "perf/budgets.json";

interface Budgets {
  bytes: {
    routeJsGzKB: Record<string, number>;
    groupShardGzKB: Record<string, number>;
    largestAssetBytes: number;
    maxFiles: number;
    coldSearchKB: { data: number; model: number; wasm: number };
  };
  work: Record<string, number>;
  headroom: number;
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const gzKB = (file: string) => Math.ceil(gzipSync(readFileSync(file)).byteLength / 1024);

function routeJs(route: string): number {
  const html = readFileSync(path.join(OUT, route === "/" ? "index.html" : `${route.replace(/^\/|\/$/g, "")}/index.html`), "utf8");
  const srcs = new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1] as string).filter((s) => s.startsWith("/_next/")));
  let kb = 0;
  for (const s of srcs) kb += gzKB(path.join(OUT, s));
  return kb;
}

function main(): void {
  const write = process.argv.includes("--write");
  const budgets = JSON.parse(readFileSync(BUDGETS, "utf8")) as Budgets;
  const manifest = ManifestSchema.parse(JSON.parse(readFileSync(path.join(OUT, "data/manifest.json"), "utf8")));
  const shardDir = path.join(OUT, manifest.shardBase.replace(/^\//, ""));
  const shardGz = new Map<string, number>();
  for (const s of manifest.shards) {
    let kb = 0;
    for (const f of Object.values(s.files)) kb += gzKB(path.join(shardDir, s.id, f));
    shardGz.set(s.id, kb);
  }
  const groupKB: Record<string, number> = {};
  for (const [g, ids] of Object.entries(manifest.groups)) groupKB[g] = (ids ?? []).reduce((s, id) => s + (shardGz.get(id) ?? 0), 0);
  groupKB.other = shardGz.get(manifest.allShard) ?? 0;
  let largest = 0;
  let files = 0;
  for (const f of walk(OUT)) {
    files++;
    largest = Math.max(largest, statSync(f).size);
  }
  const modelKB = Math.ceil([...walk(path.join(OUT, "models"))].reduce((s, f) => s + statSync(f).size, 0) / 1024);
  const wasmKB = Math.ceil([...walk(path.join(OUT, "ort"))].reduce((s, f) => s + statSync(f).size, 0) / 1024);
  const measured = {
    routeJsGzKB: Object.fromEntries(Object.keys(budgets.bytes.routeJsGzKB).map((r) => [r, routeJs(r)])),
    groupShardGzKB: groupKB,
    largestAssetBytes: largest,
    maxFiles: files,
    coldSearchKB: { data: Math.max(...Object.values(groupKB)), model: modelKB, wasm: wasmKB },
  };

  const rows: [string, number, number][] = [];
  for (const [r, v] of Object.entries(measured.routeJsGzKB)) rows.push([`route JS gz ${r}`, v, budgets.bytes.routeJsGzKB[r] ?? Infinity]);
  for (const [g, v] of Object.entries(measured.groupShardGzKB)) rows.push([`shards gz ${g}`, v, budgets.bytes.groupShardGzKB[g] ?? Infinity]);
  rows.push(["largest asset (bytes)", largest, budgets.bytes.largestAssetBytes]);
  rows.push(["files", files, budgets.bytes.maxFiles]);
  rows.push(["cold search data KB", measured.coldSearchKB.data, budgets.bytes.coldSearchKB.data]);
  rows.push(["cold search model KB", modelKB, budgets.bytes.coldSearchKB.model]);
  rows.push(["cold search wasm KB", wasmKB, budgets.bytes.coldSearchKB.wasm]);
  let over = 0;
  for (const [name, v, b] of rows) {
    const bad = v > b;
    if (bad) over++;
    console.log(`${bad ? "OVER" : "ok  "} ${name.padEnd(34)} ${String(v).padStart(10)} / ${b === Infinity ? "(no budget)" : b}`);
  }
  if (write) {
    const h = budgets.headroom;
    const round = (x: number) => Math.ceil(x * h);
    budgets.bytes.routeJsGzKB = Object.fromEntries(Object.entries(measured.routeJsGzKB).map(([k, v]) => [k, round(v)]));
    budgets.bytes.groupShardGzKB = Object.fromEntries(Object.entries(measured.groupShardGzKB).map(([k, v]) => [k, round(v)]));
    budgets.bytes.coldSearchKB = { data: round(measured.coldSearchKB.data), model: round(modelKB), wasm: round(wasmKB) };
    writeFileSync(BUDGETS, `${JSON.stringify(budgets, null, 2)}\n`);
    console.log(`wrote ${BUDGETS} (headroom x${h})`);
    return;
  }
  if (over) {
    console.error(`${over} budget(s) exceeded`);
    process.exit(1);
  }
  console.log("budgets ok");
}

main();
