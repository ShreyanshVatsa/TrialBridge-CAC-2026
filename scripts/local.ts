/**
 * `npm run local`: run the whole app locally with one command.
 *   --check      print what would be done, do nothing
 *   --rebuild    force `npm run build`
 *   --open       open the browser (macOS `open`, Linux `xdg-open`) when the server is ready
 *   --port=N     wrangler port (default 8787)
 *   --mode=national|seed|demo  (set by `npm run local:national`, `npm run local:seed`, `npm run demo`)
 *
 * `npm run demo` is the quick-start path: no account, no national download. It keeps the data already on disk,
 * builds the committed seed when there is none, and replays the sample patient's recorded real-AI answers
 * (data/demo/recorded-ai.json, made by `npm run demo:record`) so every run is instant and identical. Anything not
 * recorded uses the real AI keys in .dev.vars (a local model or an API key), or the mock provider without keys.
 * It defaults to port 8790, so it can run next to `npm run local` (8787).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { AI_PROVIDERS } from "../config/ai-providers";
import { printSelfCheck, runSelfCheck } from "./local-check";
import { aiMode, nodeOk, parseEnvFile, planLocal, type LocalMode, type LocalState } from "./local-plan";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const check = flag("check");
const mode = (opt("mode") ?? "default") as LocalMode;
const port = Number(opt("port") ?? (mode === "demo" ? 8790 : 8787));
/** The npm command that starts this mode, for hints (`npm run demo -- --port=N` passes the flag through). */
const RUN_CMD = ({ default: "npm run local", demo: "npm run demo", national: "npm run local:national", seed: "npm run local:seed" } satisfies Record<LocalMode, string>)[mode] ?? "npm run local";

const say = (m = "") => console.log(m);
function die(msg: string, hint?: string, code = 1): never {
  console.error(`\nlocal: ${msg}${hint ? `\n  -> ${hint}` : ""}`);
  process.exit(code);
}

/** Demo mode without usable keys serves with this env file: `wrangler dev --env-file` stops wrangler from loading .dev.vars, so every AI key is blank. */
const KEYLESS_ENV = "tests/e2e/keyless.env";
/** Recorded real-AI answers for the sample patient (scripts/demo-record.ts). */
const RECORDING = "data/demo/recorded-ai.json";
const RECORDING_SQL = ".wrangler/demo-recording.sql";

/** SQL that loads the recording into the local kv table, never expiring (null when there is no recording). */
function recordingSql(): { sql: string; rows: number } | null {
  if (!existsSync(RECORDING)) return null;
  const { rows } = JSON.parse(readFileSync(RECORDING, "utf8")) as { rows: { key: string; value: string }[] };
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const sql = rows.map((r) => `INSERT OR REPLACE INTO kv (key, value, expires_at) VALUES (${q(r.key)}, ${q(r.value)}, 4102444800);`).join("\n");
  return { sql, rows: rows.length };
}
const MODEL_FILES = ["public/models/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx", "public/ort/ort-wasm-simd-threaded.wasm"];
const DEV_VARS_TEMPLATE = `# Local secrets for \`wrangler dev\`. Gitignored. Paste values yourself; never share them in chat.
# Leave empty to use the mock AI provider. LOCAL_LLM_API_KEY: any value uses npm run llm:local (llama.cpp) first.
LOCAL_LLM_API_KEY=
GROQ_API_KEY=
CEREBRAS_API_KEY=
OPENROUTER_API_KEY=
TURNSTILE_SECRET_KEY=
RATE_LIMIT_SALT=
`;

/** Interface languages: the entries of public/i18n/manifest.json (English included). */
function localeCount(): number {
  try {
    return Object.keys((JSON.parse(readFileSync("public/i18n/manifest.json", "utf8")) as { locales: Record<string, unknown> }).locales).length;
  } catch { return 0; }
}

const mtime = (p: string): number | null => {
  try { return statSync(p).mtimeMs; } catch { return null; }
};

/** Newest mtime under the given paths, skipping bulky generated dirs (data shards are covered by meta.json). */
function newestMtime(paths: string[]): number | null {
  const skip = new Set(["node_modules", ".next", "data", "models", "ort", "fonts", "shards"]);
  let newest: number | null = null;
  const walk = (p: string, top: boolean) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      if (!top && skip.has(path.basename(p))) return;
      for (const e of readdirSync(p)) walk(path.join(p, e), false);
    } else if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
  };
  for (const p of paths) walk(p, true);
  return newest;
}

function readDataVersion(): string | null {
  try {
    const v = (JSON.parse(readFileSync("public/data/meta.json", "utf8")) as { dataVersion?: unknown }).dataVersion;
    return typeof v === "string" ? v : null;
  } catch { return null; }
}

function gather(): LocalState {
  const srcs = ["app", "components", "lib", "config", "content", "public", "next.config.ts", "package.json", "postcss.config.mjs", "scripts/postbuild.ts", "scripts/sw-build.ts"];
  const times = [newestMtime(srcs), mtime("public/data/meta.json"), mtime("data/build/criteria.sql")].filter((t): t is number => t !== null);
  return {
    mode, rebuild: flag("rebuild"),
    modelFilesPresent: MODEL_FILES.every(existsSync),
    dataVersion: readDataVersion(),
    criteriaSqlPresent: existsSync("data/build/criteria.sql"),
    devVarsPresent: existsSync(".dev.vars"),
    buildMtimeMs: mtime("out/index.html"),
    newestSourceMtimeMs: times.length ? Math.max(...times) : null,
  };
}

function runStep(label: string, cmd: string, args: string[]) {
  say(`\n> ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) die(`step failed: ${label}`, `run "${cmd} ${args.join(" ")}" on its own to see the details`, r.status ?? 1);
}

const portBusy = (p: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect({ port: p, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });

async function main() {
  say("TrialBridge: local setup");
  // (1) environment
  if (!nodeOk(process.versions.node)) die(`Node ${process.versions.node} is too old (need >= 22).`, "install Node 22 or newer (https://nodejs.org) and retry");
  if (!existsSync("node_modules/.bin/wrangler") || !existsSync("node_modules/next")) die("dependencies are not installed.", `run: npm install   (then ${RUN_CMD})`);
  if (!existsSync("package.json") || !existsSync("scripts/ingest/index.ts")) die("run this from the TrialBridge project root.");

  const state = gather();
  const plan = planLocal(state);
  const env = existsSync(".dev.vars") ? parseEnvFile(readFileSync(".dev.vars", "utf8")) : {};
  const ai = aiMode(AI_PROVIDERS, env);
  const recording = mode === "demo" ? recordingSql() : null;

  say(`Node ${process.versions.node} ok, dependencies installed`);
  say(`Data: ${state.dataVersion ?? "none"}${plan.ingest ? ` -> will run ${plan.ingest} ingest` : " (kept as is)"}`);
  say(`AI: ${ai.mode === "mock" ? "mock provider (no usable API keys; works fully offline)" : `real provider(s): ${ai.providers.join(", ")}`}`);
  if (mode === "demo") say(`Demo: ${recording ? `replays ${recording.rows} recorded real-AI answers for the sample patient` : "no recording yet (run npm run demo:record with real AI to make one)"}`);
  say(`Plan: ${[plan.fetchModels && "fetch models", plan.ingest && `${plan.ingest} ingest`, plan.createDevVars && "create .dev.vars", plan.build ? "build" : "skip build", "preview"].filter(Boolean).join(", ")}`);
  if (plan.reasons.length) say(`Why: ${plan.reasons.join("; ")}`);
  if (check) {
    say(`\n--check: nothing was run. URL would be http://localhost:${port}`);
    return;
  }
  if (await portBusy(port)) die(`port ${port} is already in use.`, `stop the other process or use: ${RUN_CMD} -- --port=${port + 1}`);

  // (2) models, (3) data, (4) .dev.vars
  if (plan.fetchModels) runStep("Fetching embedding model + ONNX runtime (one-time)", "npm", ["run", "models:fetch"]);
  if (plan.ingest === "seed") runStep("Building the seed dataset", "npm", ["run", "ingest:seed"]);
  let usedSeed = plan.ingest === "seed";
  if (plan.ingest === "national") {
    say("\n> National ingest (all US cancer trials; resumable, the first run downloads from ClinicalTrials.gov and takes a few minutes)");
    const r = spawnSync("npm", ["run", "ingest"], { stdio: "inherit" });
    if (r.status !== 0) {
      if (state.dataVersion === null) {
        say("\nThe national download failed (offline?). Falling back to the small seed dataset so the app still works.");
        runStep("Building the seed dataset", "npm", ["run", "ingest:seed"]);
        usedSeed = true;
      } else {
        say(`\nThe national download failed; keeping the data already on this computer. Run \`${RUN_CMD}\` again when online.`);
      }
    }
  }
  if (plan.createDevVars) {
    writeFileSync(".dev.vars", DEV_VARS_TEMPLATE, { flag: "wx" });
    say("\nCreated .dev.vars with empty entries (mock AI provider). Paste API keys there yourself if you want real AI.");
  }
  if (usedSeed && mode !== "demo") {
    say("\nNote: this is the small seed dataset. Run `npm run ingest` (resumable, ~12 s when cached, longer the first time) for all ~5,700 national cancer trials, then `npm run local` again.");
  }

  // (5) build under no lock here: callers coordinating shared machines hold their own lock around this script.
  if (plan.build) runStep("Building (npm run build)", "npm", ["run", "build"]);

  // (6) preview
  say(`\n> Starting preview on port ${port} (Ctrl+C to stop)`);
  let child: ChildProcess;
  if (mode === "demo") {
    runStep("Preparing the local database", "npm", ["run", "db:migrate:local"]);
    runStep("Loading trial criteria into the local database", "npm", ["run", "db:seed:local"]);
    // A fresh demo starts with empty rate-limit counters and only the recorded answers cached.
    runStep("Clearing local rate limits and cached answers", "npx", ["wrangler", "d1", "execute", "trialbridge", "--local", "--command", "DELETE FROM kv"]);
    if (recording && recording.rows > 0) {
      mkdirSync(path.dirname(RECORDING_SQL), { recursive: true });
      writeFileSync(RECORDING_SQL, recording.sql);
      runStep("Loading the recorded AI answers", "npx", ["wrangler", "d1", "execute", "trialbridge", "--local", "--file", RECORDING_SQL]);
    }
    const envArgs = ai.mode === "mock" ? ["--env-file", KEYLESS_ENV] : [];
    child = spawn("npx", ["wrangler", "dev", "--port", String(port), "--var", "DEMO_MODE:1", ...envArgs], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  } else {
    child = spawn("npm", ["run", "preview", "--", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  }
  let announced = false;
  let stopping = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    const url = `http://localhost:${port}`;
    say(`\n=== TrialBridge is running at ${url} ===`);
    say("Available offline: guided questionnaire, private in-browser matching on the dataset above, trial pages,");
    say(`Access Intelligence, saved print views, PWA install, ${localeCount()}-language UI (machine-translated), ${ai.mode === "mock" ? "mock" : "real"} AI analysis / Trial Q&A.`);
    say("Needs internet or keys only for: real AI providers, live ClinicalTrials.gov refresh (npm run ingest).\n");
    void runSelfCheck(url, fetch, { expectMock: ai.mode === "mock", liveAi: ai.mode === "real" }).then((c) => {
      printSelfCheck(c);
      if (!c.ok) {
        console.error("The server is running but a check failed, so the browser was NOT opened. See the FAIL lines above.");
        return;
      }
      if (flag("open") && !flag("no-open")) {
        // macOS has `open`, most Linux desktops `xdg-open`; without either, keep serving and print the URL.
        spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true })
          .on("error", () => say(`Open ${url} in your browser.`))
          .unref();
      }
    });
  };
  const onData = (buf: Buffer) => {
    const text = buf.toString();
    process.stdout.write(text);
    if (/Ready on|Listening on|\[wrangler:info\] Ready/i.test(text)) announce();
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    say("\nStopping...");
    try { process.kill(-child.pid!, "SIGTERM"); } catch { /* already gone */ }
    setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } process.exit(code); }, 4000).unref();
  };
  process.on("SIGINT", () => stop(130));
  process.on("SIGTERM", () => stop(143));
  child.on("exit", (code, sig) => {
    if (stopping) process.exit(process.exitCode ?? 130);
    die(`preview exited (${sig ?? code}).`, "check the output above; common causes: port in use, or a missing build (try --rebuild)", code ?? 1);
  });
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
