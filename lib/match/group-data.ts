/**
 * One loader for "everything the matcher needs about a cancer group": the manifest, the group's shard(s) (full or
 * the lite cross-group index) and their entries (card, sites, int8 vector). Shared by the search, the questionnaire's
 * candidate pool and the prefetch, so the shard files are fetched, parsed and cached exactly once per session.
 *
 * Stale-manifest recovery: shard URLs are immutable and content-versioned, so a manifest cached by the browser can
 * point at files a later deploy removed (404). On `not_found` the manifest is re-fetched past the HTTP cache and the
 * load is retried once with the new version.
 */
import type { CancerGroupId } from "@/config/cancer-groups";
import { DataLoadError, loadLiteShard, loadManifest, loadShard, refreshManifest, type FetchOptions } from "@/lib/data/loader";
import type { Manifest, ShardInfo } from "@/lib/types/trial";
import { liteToEntries } from "./lite";
import type { RankEntry } from "./rank";

interface GroupShard {
  info: ShardInfo;
  /** Serialized MiniSearch index (parsed lazily by lib/match/keyword.ts). */
  indexJson: string;
  entries: RankEntry[];
}

interface GroupData {
  manifest: Manifest;
  shards: GroupShard[];
}

/** Shard descriptors a group searches: its own part(s) plus the basket shard, or the lite index for "not sure". */
function groupShardInfos(manifest: Manifest, cancerType: CancerGroupId): ShardInfo[] {
  const ids = cancerType === "other" ? [manifest.allShard] : (manifest.groups[cancerType] ?? []);
  return manifest.shards.filter((s) => ids.includes(s.id));
}

async function loadAll(manifest: Manifest, cancerType: CancerGroupId, opts: FetchOptions): Promise<GroupShard[]> {
  const infos = groupShardInfos(manifest, cancerType);
  const dims = manifest.embedding.dims;
  const fractions = infos.map(() => 0);
  const report = opts.onProgress;
  const progressFor = (i: number) => (f: number) => {
    fractions[i] = f;
    report?.(fractions.reduce((x, y) => x + y, 0) / infos.length);
  };
  const signalOpt = opts.signal ? { signal: opts.signal } : {};
  return Promise.all(
    infos.map(async (info, i): Promise<GroupShard> => {
      const o = { ...signalOpt, ...(report ? { onProgress: progressFor(i) } : {}) };
      if (info.kind === "lite") {
        const lite = await loadLiteShard(info, manifest.shardBase, o);
        return { info, indexJson: lite.indexJson, entries: liteToEntries(lite, dims) };
      }
      const s = await loadShard(info, manifest.shardBase, o);
      return { info, indexJson: s.indexJson, entries: s.cards.map((card, j) => ({ card, sites: s.sites[card.id] ?? [], vector: s.embeddings.subarray(j * dims, (j + 1) * dims) })) };
    }),
  );
}

/** The group's shards and entries, with one stale-manifest retry. Only static files are fetched. */
export async function loadGroupShards(cancerType: CancerGroupId, opts: FetchOptions = {}): Promise<GroupData> {
  const manifest = await loadManifest();
  try {
    return { manifest, shards: await loadAll(manifest, cancerType, opts) };
  } catch (err) {
    if (!(err instanceof DataLoadError) || err.code !== "not_found") throw err;
    const fresh = await refreshManifest();
    if (fresh.dataVersion === manifest.dataVersion) throw err;
    return { manifest: fresh, shards: await loadAll(fresh, cancerType, opts) };
  }
}
