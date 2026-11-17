import { mkdir, readdir, readFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { assetFile } from "./assets.ts";
import { ASSET_DIR, CLIP_DIR, COMFYUI_INPUT_DIR, JOB_DIR } from "./config.ts";
import { listJobs } from "./jobs.ts";
import { SETTINGS_FILE } from "./settings.ts";
import type { Asset } from "./types.ts";

const DAY = 24 * 60 * 60 * 1000;
const ASSET_GRACE = DAY;
const KEY_PATTERN = /viggle-studio\/([a-f0-9]{8})/;

export type DirStats = { bytes: number; files: number };

export async function dirStats(dir: string): Promise<DirStats> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await dirStats(full);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      const info = await stat(full).catch(() => null);
      if (info) {
        bytes += info.size;
        files += 1;
      }
    }
  }
  return { bytes, files };
}

export function comfyRoots() {
  if (!COMFYUI_INPUT_DIR) return null;
  return {
    input: path.join(COMFYUI_INPUT_DIR, "viggle-studio"),
    output: path.join(path.dirname(COMFYUI_INPUT_DIR), "output", "viggle-studio"),
  };
}

export class PurgeBlockedError extends Error {
  active: number;

  constructor(active: number) {
    super(`Cancel ${active} active job${active === 1 ? "" : "s"} before deleting all app data.`);
    this.name = "PurgeBlockedError";
    this.active = active;
  }
}

export type PurgeResult = {
  removedAssets: number;
  removedJobs: number;
  removedClips: number;
  removedComfy: number;
  removedSettings: boolean;
  freedBytes: number;
};

export async function purgeAppData(options: { cleanComfy?: boolean; resetSettings?: boolean } = {}): Promise<PurgeResult> {
  const jobs = await listJobs(100000);
  const active = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  if (active) throw new PurgeBlockedError(active);

  const [assets, clips, savedJobs] = await Promise.all([
    dirStats(ASSET_DIR),
    dirStats(CLIP_DIR),
    dirStats(JOB_DIR),
  ]);
  let freedBytes = assets.bytes + clips.bytes + savedJobs.bytes;

  await rm(ASSET_DIR, { recursive: true, force: true });
  await rm(CLIP_DIR, { recursive: true, force: true });
  await rm(JOB_DIR, { recursive: true, force: true });
  await Promise.all([ASSET_DIR, CLIP_DIR, JOB_DIR].map((dir) => mkdir(dir, { recursive: true })));

  let removedComfy = 0;
  if (options.cleanComfy) {
    const roots = comfyRoots();
    if (roots) {
      for (const root of [roots.input, roots.output]) {
        const entries = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const target = path.join(/* turbopackIgnore: true */ root, entry.name);
          const info = entry.isDirectory()
            ? await dirStats(target)
            : await stat(target).then((stats) => ({ bytes: stats.size, files: 1 })).catch(() => null);
          if (!info) continue;
          await rm(target, { recursive: true, force: true }).catch(() => {});
          removedComfy += 1;
          freedBytes += info.bytes;
        }
      }
    }
  }

  let removedSettings = false;
  if (options.resetSettings) {
    const info = await stat(SETTINGS_FILE).catch(() => null);
    if (info) {
      await rm(SETTINGS_FILE, { force: true }).catch(() => {});
      removedSettings = true;
      freedBytes += info.size;
    }
  }

  return {
    removedAssets: assets.files,
    removedJobs: savedJobs.files,
    removedClips: clips.files,
    removedComfy,
    removedSettings,
    freedBytes,
  };
}

export async function clearClipCache() {
  const entries = await readdir(CLIP_DIR, { withFileTypes: true }).catch(() => []);
  let removedClips = 0;
  let freedBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith(".tmp.mp4")) continue;
    const file = path.join(/* turbopackIgnore: true */ CLIP_DIR, entry.name);
    const info = await stat(file).catch(() => null);
    if (!info) continue;
    await unlink(file).catch(() => {});
    removedClips += 1;
    freedBytes += info.size;
  }
  return { removedClips, freedBytes };
}

export async function storageStats() {
  const [assets, clips, jobs] = await Promise.all([dirStats(ASSET_DIR), dirStats(CLIP_DIR), dirStats(JOB_DIR)]);
  const roots = comfyRoots();
  let comfy: { input: DirStats; output: DirStats } | null = null;
  if (roots) {
    const [input, output] = await Promise.all([dirStats(roots.input), dirStats(roots.output)]);
    comfy = { input, output };
  }
  return { assets, clips, jobs, comfy };
}

export async function cleanStorage(options: {
  keepAssetIds?: string[];
  clipMaxAgeDays?: number;
  cleanComfy?: boolean;
}) {
  const jobs = await listJobs(10000);
  const keepAssets = new Set<string>(options.keepAssetIds ?? []);
  for (const job of jobs) {
    if (job.assetId) keepAssets.add(job.assetId);
    if (job.resultAssetId) keepAssets.add(job.resultAssetId);
    for (const ref of job.refs ?? []) keepAssets.add(ref.assetId);
  }

  const keepKeys = new Set<string>();
  const addKey = (value?: string | null) => {
    const match = value?.match(KEY_PATTERN);
    if (match) keepKeys.add(match[1]);
  };
  for (const job of jobs) {
    addKey(job.clipInput);
    addKey(job.output?.subfolder);
    addKey(job.preview?.subfolder);
    for (const file of [...(job.frameFiles ?? []), ...(job.maskFiles ?? [])]) addKey(file.subfolder);
  }

  const now = Date.now();
  const clipCutoff = now - Math.max(1, options.clipMaxAgeDays ?? 7) * DAY;
  let removedAssets = 0;
  let removedClips = 0;
  let removedComfy = 0;
  let freedBytes = 0;

  const assetEntries = await readdir(ASSET_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of assetEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -5);
    if (keepAssets.has(id)) continue;
    const metaPath = path.join(ASSET_DIR, entry.name);
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as Asset;
      if (now - (meta.createdAt ?? 0) < ASSET_GRACE) continue;
      const file = assetFile(meta);
      const info = await stat(file).catch(() => null);
      if (info) {
        await unlink(file).catch(() => {});
        freedBytes += info.size;
      }
      await unlink(metaPath).catch(() => {});
      removedAssets += 1;
    } catch {
      // Skip unreadable records.
    }
  }

  const clipEntries = await readdir(CLIP_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of clipEntries) {
    if (!entry.isFile()) continue;
    const file = path.join(CLIP_DIR, entry.name);
    const info = await stat(file).catch(() => null);
    if (!info || info.mtimeMs > clipCutoff) continue;
    await unlink(file).catch(() => {});
    removedClips += 1;
    freedBytes += info.size;
  }

  if (options.cleanComfy) {
    const roots = comfyRoots();
    if (roots) {
      for (const root of [roots.input, roots.output]) {
        const entries = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (!entry.isDirectory() || !/^[a-f0-9]{8}$/.test(entry.name) || keepKeys.has(entry.name)) continue;
          const dir = path.join(root, entry.name);
          const info = await stat(dir).catch(() => null);
          if (!info || now - info.mtimeMs < ASSET_GRACE) continue;
          const size = await dirStats(dir);
          await rm(dir, { recursive: true, force: true });
          removedComfy += 1;
          freedBytes += size.bytes;
        }
      }
    }
  }

  return { removedAssets, removedClips, removedComfy, freedBytes };
}
