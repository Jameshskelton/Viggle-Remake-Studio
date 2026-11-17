import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(os.tmpdir(), "viggle-settings-"));
process.env.DATA_DIR = dir;
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import("../lib/settings.ts");
const settingsFile = path.join(dir, "settings.json");

beforeEach(async () => {
  await rm(settingsFile, { force: true });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("uses the environment defaults when there is no settings file", async () => {
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.swapSteps, 6);
  assert.equal(DEFAULT_SETTINGS.editSteps, 6);
});

test("saves model changes, LoRA lists and sampling steps atomically", async () => {
  const saved = await saveSettings({
    textEncoder: "custom-text.safetensors",
    swapLoras: [
      { name: "first.safetensors", strength: 0.75 },
      { name: "second.safetensors", strength: 1.2 },
    ],
    editLoras: [],
    swapSteps: 8,
    editSteps: 4,
  });

  assert.equal(saved.textEncoder, "custom-text.safetensors");
  assert.deepEqual(saved.swapLoras, [
    { name: "first.safetensors", strength: 0.75 },
    { name: "second.safetensors", strength: 1.2 },
  ]);
  assert.deepEqual(saved.editLoras, []);
  assert.equal(saved.swapSteps, 8);
  assert.equal(saved.editSteps, 4);
  assert.deepEqual(await loadSettings(), saved);

  const files = await readdir(dir);
  assert.ok(files.includes("settings.json"));
  assert.equal(files.some((file) => file.endsWith(".tmp")), false);
});

test("rejects an empty required model and keeps the old file", async () => {
  const saved = await saveSettings({ textEncoder: "first.safetensors" });
  await assert.rejects(() => saveSettings({ textEncoder: "   " }), /cannot be empty/);
  assert.deepEqual(await loadSettings(), saved);
});

test("rejects control characters in model names", async () => {
  await assert.rejects(() => saveSettings({ textEncoder: "bad\nname" }), /not a valid model name/);
});

test("validates LoRA entries", async () => {
  await assert.rejects(() => saveSettings({ swapLoras: "bad" as never }), /must be a list/);
  await assert.rejects(() => saveSettings({ swapLoras: [{ name: "", strength: 1 }] }), /valid model name/);
  await assert.rejects(
    () => saveSettings({ editLoras: [{ name: "a.safetensors", strength: 3 }] }),
    /between -2 and 2/,
  );
});

test("validates sampling steps", async () => {
  await assert.rejects(() => saveSettings({ swapSteps: 0 }), /integer from 1 to 16/);
  await assert.rejects(() => saveSettings({ editSteps: 17 }), /integer from 1 to 16/);
  await assert.rejects(() => saveSettings({ editSteps: 4.5 }), /integer from 1 to 16/);
});

test("allows clearing the LoRA chains", async () => {
  const saved = await saveSettings({ swapLoras: [], editLoras: [] });
  assert.deepEqual(saved.swapLoras, []);
  assert.deepEqual(saved.editLoras, []);
  assert.deepEqual(await loadSettings(), saved);
});

test("migrates the old single-LoRA fields", async () => {
  await writeFile(settingsFile, JSON.stringify({
    swapLora: "legacy-swap.safetensors",
    editLora: "",
    swapSteps: 9,
  }));

  const settings = await loadSettings();
  assert.deepEqual(settings.swapLoras, [{ name: "legacy-swap.safetensors", strength: 1 }]);
  assert.deepEqual(settings.editLoras, []);
  assert.equal(settings.swapSteps, 9);
  assert.equal(settings.editSteps, DEFAULT_SETTINGS.editSteps);
});

test("falls back per field for missing or invalid stored values", async () => {
  await writeFile(settingsFile, JSON.stringify({
    textEncoder: 42,
    videoVae: "",
    swapLoras: [{ name: "good.safetensors", strength: 0.5 }, { name: "", strength: 1 }],
    editLoras: "bad",
    swapSteps: 99,
  }));

  const settings = await loadSettings();
  assert.equal(settings.textEncoder, DEFAULT_SETTINGS.textEncoder);
  assert.equal(settings.videoVae, DEFAULT_SETTINGS.videoVae);
  assert.deepEqual(settings.swapLoras, [{ name: "good.safetensors", strength: 0.5 }]);
  assert.deepEqual(settings.editLoras, DEFAULT_SETTINGS.editLoras);
  assert.equal(settings.swapSteps, DEFAULT_SETTINGS.swapSteps);
});

test("falls back to defaults when the file is not JSON", async () => {
  await writeFile(settingsFile, "{not json");
  assert.deepEqual(await loadSettings(), DEFAULT_SETTINGS);
});
