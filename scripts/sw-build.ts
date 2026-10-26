/** Build-id stamping for public/sw.js (used by scripts/postbuild.ts; unit tested). */
import { createHash } from "node:crypto";

export const SW_PLACEHOLDER = "__TB_BUILD_ID__";

/** Deterministic id from the shell files (path + bytes), order independent. Same shell gives the same id. */
export function computeBuildId(files: readonly [path: string, content: Uint8Array | string][]): string {
  const h = createHash("sha256");
  for (const [p, content] of [...files].sort((a, b) => a[0].localeCompare(b[0]))) {
    h.update(p).update("\0").update(content).update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

export function stampServiceWorker(source: string, buildId: string): string {
  if (!/^[a-f0-9]{6,64}$/.test(buildId)) throw new Error(`invalid build id: ${buildId}`);
  if (!source.includes(SW_PLACEHOLDER)) throw new Error("service worker has no build id placeholder");
  return source.split(SW_PLACEHOLDER).join(buildId);
}
