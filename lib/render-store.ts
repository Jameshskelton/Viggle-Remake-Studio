import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { assetFile, assetMetadataFile, getAsset } from "./assets.ts";
import { CLIP_CACHE_PREFIX, clipCacheKey } from "./clips.ts";
import { CLIP_DIR } from "./config.ts";
import { jobFile, listJobs } from "./jobs.ts";
import { comfyRoots, dirStats } from "./storage.ts";
import type { Asset, JobRecord } from "./types.ts";

export type DeleteRendersOptions = {
  ids?: string[];
  mode?: "swap" | "edit";
  all?: boolean;
  keepAssetIds?: string[];
};

export type DeleteRendersResult = {
  deleted: number;
  skipped: number;
  removedAssets: number;
  removedClips: number;
  removedComfy: number;
  freedBytes: number;
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const KEY_PATTERN = /viggle-studio\/([a-f0-9]{8})/;

function isTerminalRender(job: JobRecord) {
  return job.kind === "render" && TERMINAL.has(job.status);
}

function addKey(keys: Set<string>, value?: string | null) {
  const match = value?.match(KEY_PATTERN);
  if (match) keys.add(match[1]);
}

function keysFor(job: JobRecord) {
  const keys = new Set<string>();
  addKey(keys, job.clipInput);
  addKey(keys, job.output?.subfolder);
  addKey(keys, job.preview?.subfolder);
  for (const file of [...(job.frameFiles ?? []), ...(job.maskFiles ?? [])]) addKey(keys, file.subfolder);
  return keys;
}

function assetsFor(job: JobRecord) {
  const ids = new Set<string>();
  if (job.assetId) ids.add(job.assetId);
  if (job.resultAssetId) ids.add(job.resultAssetId);
  for (const ref of job.refs ?? []) ids.add(ref.assetId);
  return ids;
}

export async function deleteStoredRenders(options: DeleteRendersOptions): Promise<DeleteRendersResult> {
  const all = await listJobs(100000);
  const ids = options.ids?.length ? new Set(options.ids) : null;
  const targets = all.filter((job) => {
    if (!isTerminalRender(job)) return false;
    if (ids) return ids.has(job.id);
    if (options.mode) return (job.mode ?? "swap") === options.mode;
    return options.all === true;
  });

  const skipped = ids
    ? [...ids].filter((id) => {
        const job = all.find((item) => item.id === id);
        return !job || !isTerminalRender(job);
      }).length
    : 0;

  const targetIds = new Set(targets.map((job) => job.id));
  const remaining = all.filter((job) => !targetIds.has(job.id));
  const keepAssets = new Set(options.keepAssetIds ?? []);
  const remainingAssets = new Set<string>();
  for (const job of remaining) for (const id of assetsFor(job)) remainingAssets.add(id);
  const resultAssets = new Set<string>();
  for (const job of targets) if (job.resultAssetId) resultAssets.add(job.resultAssetId);

  const assetCache = new Map<string, Asset | null>();
  const loadAsset = async (id: string) => {
    if (!assetCache.has(id)) assetCache.set(id, await getAsset(id));
    return assetCache.get(id) ?? null;
  };
  const clipsFor = async (job: JobRecord) => {
    if (!job.assetId || !Number.isFinite(job.start) || !Number.isFinite(job.frames)) return [];
    const asset = await loadAsset(job.assetId);
    if (asset) {
      return [`${clipCacheKey(job.assetId, job.start, job.frames, asset.hasAudio ?? true)}.mp4`];
    }
    return [
      `${clipCacheKey(job.assetId, job.start, job.frames, true)}.mp4`,
      `${clipCacheKey(job.assetId, job.start, job.frames, false)}.mp4`,
    ];
  };
  const remainingClips = new Set<string>();
  for (const job of remaining) for (const name of await clipsFor(job)) remainingClips.add(name);

  let freedBytes = 0;
  let deleted = 0;
  for (const job of targets) {
    try {
      const info = await stat(jobFile(job.id)).catch(() => null);
      if (info) freedBytes += info.size;
      await rm(jobFile(job.id), { force: true });
      deleted += 1;
    } catch {
      // Leave the record for a later cleanup.
    }
  }

  let removedAssets = 0;
  for (const id of resultAssets) {
    if (keepAssets.has(id) || remainingAssets.has(id)) continue;
    const asset = await getAsset(id);
    if (!asset) continue;
    const file = assetFile(asset);
    const fileInfo = await stat(file).catch(() => null);
    if (fileInfo) {
      await rm(file, { force: true }).catch(() => {});
      freedBytes += fileInfo.size;
    }
    const meta = assetMetadataFile(id);
    const metaInfo = await stat(meta).catch(() => null);
    if (metaInfo) {
      await rm(meta, { force: true }).catch(() => {});
      freedBytes += metaInfo.size;
    }
    removedAssets += 1;
  }

  const remainingKeys = new Set<string>();
  for (const job of remaining) for (const key of keysFor(job)) remainingKeys.add(key);
  const targetKeys = new Set<string>();
  for (const job of targets) for (const key of keysFor(job)) targetKeys.add(key);

  let removedClips = 0;
  const clipEntries = await readdir(CLIP_DIR).catch(() => []);
  for (const name of clipEntries) {
    if (!name.endsWith(".mp4") || name.endsWith(".tmp.mp4")) continue;
    if (name.startsWith(CLIP_CACHE_PREFIX) && remainingClips.has(name)) continue;
    const file = path.join(CLIP_DIR, name);
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    await rm(file, { force: true }).catch(() => {});
    removedClips += 1;
    freedBytes += info.size;
  }

  let removedComfy = 0;
  const roots = comfyRoots();
  if (roots) {
    for (const key of targetKeys) {
      if (remainingKeys.has(key)) continue;
      for (const root of [roots.input, roots.output]) {
        const dir = path.join(root, key);
        const info = await stat(dir).catch(() => null);
        if (!info) continue;
        const size = await dirStats(dir);
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        removedComfy += 1;
        freedBytes += size.bytes;
      }
    }
  }

  return { deleted, skipped, removedAssets, removedClips, removedComfy, freedBytes };
}
