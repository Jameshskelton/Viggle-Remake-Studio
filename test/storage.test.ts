import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Asset } from "../lib/types.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "viggle-storage-"));
const dataDir = path.join(root, "data");
const comfyInput = path.join(root, "comfy", "input");
const comfyOutput = path.join(root, "comfy", "output");
process.env.DATA_DIR = dataDir;
process.env.COMFYUI_INPUT_DIR = comfyInput;

await mkdir(comfyInput, { recursive: true });
await mkdir(comfyOutput, { recursive: true });

const { assetFile, assetMetadataFile, saveAsset } = await import("../lib/assets.ts");
const { CLIP_DIR } = await import("../lib/config.ts");
const { cleanStorage, clearClipCache, storageStats } = await import("../lib/storage.ts");
const { saveJob } = await import("../lib/jobs.ts");

const DAY = 24 * 60 * 60 * 1000;
const KEY = { referenced: "aaaaaaaa", orphan: "bbbbbbbb", fresh: "cccccccc" };

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function exists(file: string) {
  return stat(file).then(() => true).catch(() => false);
}

async function backdateAsset(asset: Asset) {
  const file = assetMetadataFile(asset.id);
  const meta = JSON.parse(await readFile(file, "utf8")) as Asset;
  meta.createdAt = Date.now() - 2 * DAY;
  await writeFile(file, JSON.stringify(meta));
}

test("cleanup keeps referenced assets and removes old unused ones", async () => {
  const old = await saveAsset(new Uint8Array([1, 2, 3]), "old.png", "image/png", "image");
  const fresh = await saveAsset(new Uint8Array([4]), "fresh.png", "image/png", "image");
  const referenced = await saveAsset(new Uint8Array([5, 6]), "referenced.png", "image/png", "image");
  const kept = await saveAsset(new Uint8Array([7]), "kept.png", "image/png", "image");
  for (const asset of [old, referenced, kept]) await backdateAsset(asset);

  await mkdir(CLIP_DIR, { recursive: true });
  const oldClip = path.join(CLIP_DIR, "old.mp4");
  const freshClip = path.join(CLIP_DIR, "fresh.mp4");
  await writeFile(oldClip, new Uint8Array([1, 2]));
  await writeFile(freshClip, new Uint8Array([3]));
  const oldTime = new Date(Date.now() - 10 * DAY);
  await utimes(oldClip, oldTime, oldTime);

  const inputRoot = path.join(comfyInput, "viggle-studio");
  const outputRoot = path.join(comfyOutput, "viggle-studio");
  for (const key of Object.values(KEY)) {
    await mkdir(path.join(inputRoot, key), { recursive: true });
    await mkdir(path.join(outputRoot, key), { recursive: true });
    await writeFile(path.join(inputRoot, key, "clip.mp4"), new Uint8Array([1]));
    await writeFile(path.join(outputRoot, key, "video.mp4"), new Uint8Array([1]));
  }
  for (const key of [KEY.referenced, KEY.orphan]) {
    const time = new Date(Date.now() - 5 * DAY);
    await utimes(path.join(inputRoot, key), time, time);
    await utimes(path.join(outputRoot, key), time, time);
  }

  await saveJob({
    id: "11111111-1111-4111-8111-111111111111",
    kind: "render",
    mode: "swap",
    createdAt: Date.now() - 3 * DAY,
    status: "succeeded",
    error: null,
    assetId: referenced.id,
    start: 0,
    frames: 90,
    clipInput: `viggle-studio/${KEY.referenced}/clip.mp4`,
    output: { filename: "video.mp4", subfolder: `viggle-studio/${KEY.referenced}`, type: "output" },
    resultAssetId: referenced.id,
  });

  const before = await storageStats();
  assert.ok(before.assets.files >= 8);
  assert.ok(before.comfy);
  assert.equal(before.comfy.input.files, 3);

  const result = await cleanStorage({
    keepAssetIds: [kept.id],
    clipMaxAgeDays: 7,
    cleanComfy: true,
  });

  assert.equal(result.removedAssets, 1);
  assert.equal(result.removedClips, 1);
  assert.equal(result.removedComfy, 2);
  assert.ok(result.freedBytes > 0);

  assert.equal(await exists(assetMetadataFile(old.id)), false);
  assert.equal(await exists(assetFile(old)), false);
  for (const asset of [fresh, referenced, kept]) {
    assert.equal(await exists(assetMetadataFile(asset.id)), true, asset.name);
    assert.equal(await exists(assetFile(asset)), true, asset.name);
  }

  assert.equal(await exists(oldClip), false);
  assert.equal(await exists(freshClip), true);

  assert.equal(await exists(path.join(inputRoot, KEY.referenced)), true);
  assert.equal(await exists(path.join(outputRoot, KEY.referenced)), true);
  assert.equal(await exists(path.join(inputRoot, KEY.orphan)), false);
  assert.equal(await exists(path.join(outputRoot, KEY.orphan)), false);
  assert.equal(await exists(path.join(inputRoot, KEY.fresh)), true);
  assert.equal(await exists(path.join(outputRoot, KEY.fresh)), true);

  const after = await storageStats();
  assert.ok(after.comfy);
  assert.equal(after.comfy.input.files, 2);
  assert.equal(after.comfy.output.files, 2);
});

test("clears the whole clip cache on demand", async () => {
  const extra = path.join(CLIP_DIR, "extra-cache.mp4");
  await writeFile(extra, new Uint8Array([7, 8, 9]));
  const result = await clearClipCache();
  assert.ok(result.removedClips >= 1);
  assert.ok(result.freedBytes > 0);
  assert.equal(await exists(extra), false);
});
