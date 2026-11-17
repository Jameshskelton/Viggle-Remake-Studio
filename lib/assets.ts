import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ASSET_DIR, CLIP_DIR, JOB_DIR } from "./config.ts";
import { probeVideo } from "./ffmpeg.ts";
import type { Asset, AssetKind } from "./types.ts";

const MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export async function ensureDirs() {
  await Promise.all([ASSET_DIR, JOB_DIR, CLIP_DIR].map((dir) => mkdir(dir, { recursive: true })));
}

function safeExt(name: string, mime: string) {
  const fromName = path.extname(name).replace(/^\./, "").toLowerCase();
  if (/^[a-z0-9]{1,5}$/.test(fromName)) return fromName;
  return MIME_EXT[mime] ?? (mime.startsWith("video/") ? "mp4" : "png");
}

export function assetFile(asset: Asset) {
  return path.join(/* turbopackIgnore: true */ ASSET_DIR, `${asset.id}.${safeExt(asset.name, asset.mime)}`);
}

export function assetMetadataFile(id: string) {
  return path.join(/* turbopackIgnore: true */ ASSET_DIR, `${id}.json`);
}

export async function saveAsset(bytes: Uint8Array, name: string, mime: string, kind: AssetKind): Promise<Asset> {
  await ensureDirs();
  const id = randomUUID();
  const asset: Asset = { id, kind, name, mime, size: bytes.length, createdAt: Date.now() };
  if (kind === "video") {
    const ext = safeExt(name, mime);
    const file = path.join(/* turbopackIgnore: true */ ASSET_DIR, `${id}.${ext}`);
    await writeFile(file, bytes);
    const info = await probeVideo(file);
    Object.assign(asset, info);
  } else {
    const ext = safeExt(name, mime);
    await writeFile(path.join(/* turbopackIgnore: true */ ASSET_DIR, `${id}.${ext}`), bytes);
  }
  await writeFile(assetMetadataFile(id), JSON.stringify(asset, null, 2));
  return asset;
}

export async function getAsset(id: string): Promise<Asset | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  try {
    return JSON.parse(await readFile(assetMetadataFile(id), "utf8")) as Asset;
  } catch {
    return null;
  }
}
