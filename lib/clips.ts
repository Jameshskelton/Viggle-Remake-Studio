import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { assetFile } from "./assets.ts";
import { CLIP_DIR } from "./config.ts";
import { makeClip, probeVideo } from "./ffmpeg.ts";
import type { Asset } from "./types.ts";

const CLIP_CACHE_VERSION = 1;
export const CLIP_CACHE_PREFIX = `v${CLIP_CACHE_VERSION}-`;

export function clipCacheKey(assetId: string, start: number, frames: number, hasAudio: boolean) {
  return `${CLIP_CACHE_PREFIX}${assetId}-${start.toFixed(6)}-${frames}-${hasAudio ? "a" : "s"}`;
}

export type PreparedClip = {
  file: string;
  key: string;
  start: number;
  looped: boolean;
  cached: boolean;
};

export function normalizeClipStart(sourceDuration: number, start: number) {
  return Math.max(0, Math.min(start, Math.max(0, sourceDuration - 1 / 24)));
}

export async function prepareClip(asset: Asset, start: number, frames: number): Promise<PreparedClip> {
  const source = assetFile(asset);
  const sourceDuration = asset.duration ?? (await probeVideo(source)).duration;
  const safeStart = normalizeClipStart(sourceDuration, start);
  const window = frames / 24;
  const looped = safeStart + window > sourceDuration + 0.01;
  const hasAudio = asset.hasAudio ?? true;
  const key = clipCacheKey(asset.id, safeStart, frames, hasAudio);
  const file = path.join(/* turbopackIgnore: true */ CLIP_DIR, `${key}.mp4`);

  try {
    const info = await stat(file);
    if (info.size > 0) return { file, key, start: safeStart, looped, cached: true };
  } catch {
    // Not cached yet.
  }

  await mkdir(CLIP_DIR, { recursive: true });
  const temp = path.join(/* turbopackIgnore: true */ CLIP_DIR, `${key}.${randomUUID()}.tmp.mp4`);
  try {
    await makeClip(source, safeStart, frames, temp, hasAudio, sourceDuration);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return { file, key, start: safeStart, looped, cached: false };
}
