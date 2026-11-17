import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { JobRecord } from "../lib/types.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "viggle-purge-"));
const dataDir = path.join(root, "data");
const comfyInput = path.join(root, "comfy", "input");
const comfyOutput = path.join(root, "comfy", "output");
process.env.DATA_DIR = dataDir;
process.env.COMFYUI_INPUT_DIR = comfyInput;

await mkdir(comfyInput, { recursive: true });
await mkdir(comfyOutput, { recursive: true });

const { ASSET_DIR, CLIP_DIR, JOB_DIR } = await import("../lib/config.ts");
const { SETTINGS_FILE } = await import("../lib/settings.ts");
const { assetMetadataFile, saveAsset } = await import("../lib/assets.ts");
const { saveJob } = await import("../lib/jobs.ts");
const { purgeAppData, PurgeBlockedError } = await import("../lib/storage.ts");

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function exists(file: string) {
  return stat(file).then(() => true).catch(() => false);
}

async function makeKey(key: string) {
  for (const rootDir of [comfyInput, comfyOutput]) {
    const dir = path.join(rootDir, "viggle-studio", key);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "file.bin"), new Uint8Array([1, 2, 3]));
  }
}

function job(id: string, status: JobRecord["status"], createdAt = 1_000): JobRecord {
  return {
    id,
    kind: "render",
    mode: "swap",
    createdAt,
    status,
    error: null,
    assetId: "11111111-1111-4111-8111-111111111111",
    start: 0,
    frames: 90,
  };
}

test("purges assets, jobs, clips and ComfyUI folders while keeping settings", async () => {
  const asset = await saveAsset(new Uint8Array([1, 2]), "purge.png", "image/png", "image");
  await saveJob(job("22222222-2222-4222-8222-222222222222", "succeeded"));
  await mkdir(CLIP_DIR, { recursive: true });
  await writeFile(path.join(CLIP_DIR, "clip.mp4"), new Uint8Array([3, 4, 5]));
  await makeKey("aaaaaaaa");
  await writeFile(SETTINGS_FILE, JSON.stringify({ textEncoder: "kept.safetensors" }));

  const result = await purgeAppData({ cleanComfy: true, resetSettings: false });

  assert.equal(result.removedAssets, 2);
  assert.equal(result.removedJobs, 1);
  assert.equal(result.removedClips, 1);
  assert.equal(result.removedComfy, 2);
  assert.equal(result.removedSettings, false);
  assert.ok(result.freedBytes > 0);

  assert.deepEqual(await readdir(ASSET_DIR), []);
  assert.deepEqual(await readdir(JOB_DIR), []);
  assert.deepEqual(await readdir(CLIP_DIR), []);
  assert.deepEqual(await readdir(path.join(comfyInput, "viggle-studio")), []);
  assert.deepEqual(await readdir(path.join(comfyOutput, "viggle-studio")), []);
  assert.equal(await exists(SETTINGS_FILE), true);
  assert.equal(await exists(assetMetadataFile(asset.id)), false);
});

test("refuses to purge while a job is active, then can reset settings", async () => {
  const asset = await saveAsset(new Uint8Array([6]), "active.png", "image/png", "image");
  const active = job("33333333-3333-4333-8333-333333333333", "running");
  await saveJob(active);
  await writeFile(SETTINGS_FILE, "{}");

  await assert.rejects(
    () => purgeAppData({ cleanComfy: true }),
    (error) => error instanceof PurgeBlockedError && error.active === 1,
  );
  assert.equal(await exists(assetMetadataFile(asset.id)), true);
  assert.equal(await exists(SETTINGS_FILE), true);

  await saveJob({ ...active, status: "succeeded" });
  const result = await purgeAppData({ resetSettings: true });

  assert.equal(result.removedSettings, true);
  assert.equal(await exists(assetMetadataFile(asset.id)), false);
  assert.equal(await exists(SETTINGS_FILE), false);
});
