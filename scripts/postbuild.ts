/**
 * postbuild (after `next build` writes ./out):
 * 1. Externalize inline <script> blocks into /_next/static/inline/<sha256>.js so the CSP needs no
 *    'unsafe-inline' or per-page hashes. Classic scripts are merged into one deferred file per page
 *    (relative order preserved, no render blocking, fewer requests).
 * 2. Fail if any inline event handler attributes exist (blocked by CSP anyway).
 * 3. Secret scan: fail if anything that looks like an API key or secret is in the build output.
 * 4. Remove ONNX Runtime .wasm copies the bundler emits into _next/static/media: the worker loads
 *    the runtime from /ort/ (explicit wasmPaths), and the bundler's asyncify copy exceeds
 *    Cloudflare's 25 MiB per-asset limit.
 * 5. Stamp public/sw.js (copied to out/sw.js) with a build id derived from the built shell, so each
 *    deploy has new worker bytes and its own cache name (old caches are deleted on activate).
 */
import { readdir, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { SW_PLACEHOLDER, computeBuildId, stampServiceWorker } from "./sw-build";

const OUT = "out";
// Must live under /_next/: Next's runtime checks document.currentScript.src contains "/_next/".
const INLINE_DIR = path.join(OUT, "_next/static/inline");
const SECRET_PATTERNS: [string, RegExp][] = [
  ["Groq key", /gsk_[A-Za-z0-9]{20,}/],
  ["Cerebras key", /csk-[A-Za-z0-9]{20,}/],
  ["OpenRouter key", /sk-or-v1-[A-Za-z0-9]{20,}/],
  ["OpenAI-style key", /\bsk-[A-Za-z0-9]{32,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Turnstile secret (non-test)", /0x4AAAAAAA[A-Za-z0-9_-]{20,}/],
  ["Bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{24,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["Env secret assignment", /\b(?:GROQ|CEREBRAS|OPENROUTER)_API_KEY\s*[:=]\s*["'][^"']{8,}|RATE_LIMIT_SALT\s*[:=]\s*["'][^"']{8,}|TURNSTILE_SECRET_KEY\s*[:=]\s*["'][^"']{8,}/],
  ["Cloudflare API token var", /CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][^"']+/],
];
const TEXT_EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".txt", ".map", ".webmanifest", ".xml"]);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main(): Promise<void> {
  await mkdir(INLINE_DIR, { recursive: true });
  const mediaDir = path.join(OUT, "_next/static/media");
  for (const f of await readdir(mediaDir).catch(() => [] as string[])) {
    // Raw worker source copies (*.ts) are emitted alongside the compiled worker chunk; not needed.
    if (/^ort-wasm.*\.wasm$/.test(f) || /\.tsx?$/.test(f)) {
      await rm(path.join(mediaDir, f));
      console.log(`postbuild: removed bundler copy ${f} (runtime served from /ort/)`);
    }
  }
  let externalized = 0;
  const problems: string[] = [];
  for await (const file of walk(OUT)) {
    const ext = path.extname(file);
    if (ext === ".html") {
      let html = await readFile(file, "utf8");
      // Classic inline scripts are concatenated (document order) into ONE deferred file per page:
      // deferred scripts run in order after parsing, so merging them is equivalent and saves requests.
      const classic: string[] = [];
      const MARK = "\u0000TB_INLINE\u0000";
      html = await replaceAsync(html, /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi, async (whole, attrs = "", body) => {
        if (/\ssrc=/i.test(attrs) || !body.trim()) return whole;
        const type = /\stype=["']?([^"'\s>]+)/i.exec(attrs)?.[1];
        if (type && !/^(text\/javascript|module|application\/javascript)$/i.test(type)) return whole; // data blocks (JSON) are not executed
        externalized++;
        if (type === "module") {
          const hash = createHash("sha256").update(body).digest("hex").slice(0, 20);
          await writeFile(path.join(INLINE_DIR, `${hash}.js`), body);
          return `<script${attrs} src="/_next/static/inline/${hash}.js"></script>`;
        }
        classic.push(body);
        return classic.length === 1 ? MARK : "";
      });
      if (classic.length) {
        const combined = classic.join(";\n");
        const hash = createHash("sha256").update(combined).digest("hex").slice(0, 20);
        await writeFile(path.join(INLINE_DIR, `${hash}.js`), combined);
        html = html.replace(MARK, `<script src="/_next/static/inline/${hash}.js" defer></script>`);
      }
      if (/\son[a-z]+=["']/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, ""))) problems.push(`inline event handler in ${file}`);
      await writeFile(file, html);
    }
    if (TEXT_EXT.has(ext) && (await stat(file)).size < 20_000_000 && !file.startsWith(path.join(OUT, "data"))) {
      const text = await readFile(file, "utf8");
      for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) problems.push(`possible ${name} in ${file}`);
    }
  }
  // Runs after the HTML rewrite above so the id reflects the final shell.
  const swFile = path.join(OUT, "sw.js");
  const swSource = await readFile(swFile, "utf8");
  if (!swSource.includes(SW_PLACEHOLDER)) problems.push(`${swFile} has no ${SW_PLACEHOLDER} placeholder`);
  else {
    const shell: [string, Buffer][] = [];
    for await (const file of walk(OUT)) {
      const rel = path.relative(OUT, file).split(path.sep).join("/");
      if (rel.endsWith(".html") || rel.startsWith("_next/static/")) shell.push([rel, await readFile(file)]);
    }
    const buildId = computeBuildId(shell);
    await writeFile(swFile, stampServiceWorker(swSource, buildId));
    console.log(`postbuild: service worker build id ${buildId} (${shell.length} shell files)`);
  }
  if (problems.length) {
    console.error(`postbuild FAILED:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`postbuild: externalized ${externalized} inline scripts; secret scan clean`);
}

async function replaceAsync(s: string, re: RegExp, fn: (...m: string[]) => Promise<string>): Promise<string> {
  const parts: Promise<string>[] = [];
  let last = 0;
  for (const m of s.matchAll(re)) {
    parts.push(Promise.resolve(s.slice(last, m.index)));
    parts.push(fn(...(m as unknown as string[])));
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(Promise.resolve(s.slice(last)));
  return (await Promise.all(parts)).join("");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
