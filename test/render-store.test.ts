import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Asset, JobRecord } from "../lib/types.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "viggle-render-store-"));
const dataDir = path.join(root, "data");
const comfyInput = path.join(root, "comfy", "input");
process.env.DATA_DIR = dataDir;
process.env.COMFYUI_INPUT_DIR = comfyInput;

await mkdir(comfyInput, { recursive: true });
await mkdir(path.join(root, "comfy", "output"), { recursive: true });

const { assetFile, assetMetadataFile, saveAsset } = await import("../lib/assets.ts");
const { saveJob } = await import("../lib/jobs.ts");
const { deleteStoredRenders } = await import("../lib/render-store.ts");
const { comfyRoots } = await import("../lib/storage.ts");
const { CLIP_DIR } = await import("../lib/config.ts");
const { clipCacheKey } = await import("../lib/clips.ts");

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function exists(file: string) {
  return stat(file).then(() => true).catch(() => false);
}

async function makeKey(key: string) {
  const roots = comfyRoots();
  assert.ok(roots);
  for (const directory of [roots.input, roots.output]) {
    await mkdir(path.join(directory, key), { recursive: true });
    await writeFile(path.join(directory, key, "file.bin"), new Uint8Array([1, 2, 3]));
  }
}

async function keyExists(key: string) {
  const roots = comfyRoots();
  assert.ok(roots);
  return (await exists(path.join(roots.input, key))) || (await exists(path.join(roots.output, key)));
}

async function makeAsset(name: string, bytes: number): Promise<Asset> {
  return saveAsset(new Uint8Array(bytes).fill(1), name, "image/png", "image");
}

function renderJob(id: string, status: JobRecord["status"], mode: "swap" | "edit", extra: Partial<JobRecord>): JobRecord {
  return {
    id,
    kind: "render",
    mode,
    createdAt: 1_000,
    status,
    error: null,
    assetId: "source",
    start: 0,
    frames: 90,
    ...extra,
  };
}

test("deletes terminal renders, their results and unreferenced ComfyUI folders", async () => {
  const source = await makeAsset("source.png", 1);
  const clipSource = await makeAsset("clip-source.png", 2);
  const swapResult = await makeAsset("swap-result.png", 3);
  const editResult = await makeAsset("edit-result.png", 4);
  const keptResult = await makeAsset("kept-result.png", 5);
  const activeResult = await makeAsset("active-result.png", 6);

  for (const key of ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"]) await makeKey(key);

  await saveJob(renderJob("11111111-1111-4111-8111-111111111111", "succeeded", "swap", {
    assetId: clipSource.id,
    resultAssetId: swapResult.id,
    clipInput: "viggle-studio/aaaaaaaa/clip.mp4",
    output: { filename: "swap.mp4", subfolder: "viggle-studio/aaaaaaaa", type: "output" },
  }));
  await saveJob(renderJob("22222222-2222-4222-8222-222222222222", "succeeded", "edit", {
    assetId: source.id,
    resultAssetId: editResult.id,
    clipInput: "viggle-studio/bbbbbbbb/clip.mp4",
    output: { filename: "edit.mp4", subfolder: "viggle-studio/bbbbbbbb", type: "output" },
  }));
  await saveJob(renderJob("33333333-3333-4333-8333-333333333333", "failed", "swap", {
    assetId: source.id,
    resultAssetId: keptResult.id,
    clipInput: "viggle-studio/dddddddd/clip.mp4",
  }));
  await saveJob(renderJob("44444444-4444-4444-8444-444444444444", "running", "swap", {
    assetId: source.id,
    resultAssetId: activeResult.id,
    clipInput: "viggle-studio/cccccccc/clip.mp4",
  }));
  await saveJob({
    id: "55555555-5555-4555-8555-555555555555",
    kind: "mask",
    createdAt: 1_000,
    status: "succeeded",
    error: null,
    assetId: editResult.id,
    start: 0,
    frames: 90,
    clipInput: "viggle-studio/bbbbbbbb/clip.mp4",
  });

  await mkdir(CLIP_DIR, { recursive: true });
  const swapClip = `${clipCacheKey(clipSource.id, 0, 90, true)}.mp4`;
  const maskClip = `${clipCacheKey(editResult.id, 0, 90, true)}.mp4`;
  await writeFile(path.join(CLIP_DIR, swapClip), new Uint8Array([1]));
  await writeFile(path.join(CLIP_DIR, maskClip), new Uint8Array([2]));
  await writeFile(path.join(CLIP_DIR, "legacy-cache.mp4"), new Uint8Array([3]));

  const result = await deleteStoredRenders({ all: true, keepAssetIds: [keptResult.id] });

  assert.equal(result.deleted, 3);
  assert.equal(result.skipped, 0);
  assert.equal(result.removedAssets, 1);
  assert.equal(result.removedClips, 2);
  assert.equal(result.removedComfy, 4);
  assert.ok(result.freedBytes > 0);

  assert.equal(await exists(assetMetadataFile(swapResult.id)), false);
  assert.equal(await exists(assetFile(swapResult)), false);
  for (const asset of [editResult, keptResult, activeResult, source]) {
    assert.equal(await exists(assetMetadataFile(asset.id)), true, asset.name);
  }

  assert.equal(await exists(path.join(CLIP_DIR, swapClip)), false);
  assert.equal(await exists(path.join(CLIP_DIR, maskClip)), true);
  assert.equal(await exists(path.join(CLIP_DIR, "legacy-cache.mp4")), false);

  assert.equal(await keyExists("aaaaaaaa"), false);
  assert.equal(await keyExists("dddddddd"), false);
  assert.equal(await keyExists("bbbbbbbb"), true);
  assert.equal(await keyExists("cccccccc"), true);
});

test("deletes only requested terminal renders and reports active or missing ids", async () => {
  const terminalId = "66666666-6666-4666-8666-666666666666";
  const activeId = "77777777-7777-4777-8777-777777777777";
  await saveJob(renderJob(terminalId, "cancelled", "edit", { createdAt: 2_000 }));
  await saveJob(renderJob(activeId, "queued", "edit", { createdAt: 3_000 }));

  const result = await deleteStoredRenders({ ids: [terminalId, activeId, "88888888-8888-4888-8888-888888888888"] });

  assert.equal(result.deleted, 1);
  assert.equal(result.skipped, 2);
  assert.equal(await exists(path.join(dataDir, "jobs", `${terminalId}.json`)), false);
  assert.equal(await exists(path.join(dataDir, "jobs", `${activeId}.json`)), true);
});

test("deletes terminal renders for one mode", async () => {
  const swapId = "99999999-9999-4999-8999-999999999999";
  const editId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await saveJob(renderJob(swapId, "succeeded", "swap", { createdAt: 4_000 }));
  await saveJob(renderJob(editId, "succeeded", "edit", { createdAt: 5_000 }));

  const result = await deleteStoredRenders({ mode: "swap" });

  assert.equal(result.deleted, 1);
  assert.equal(await exists(path.join(dataDir, "jobs", `${swapId}.json`)), false);
  assert.equal(await exists(path.join(dataDir, "jobs", `${editId}.json`)), true);
});
