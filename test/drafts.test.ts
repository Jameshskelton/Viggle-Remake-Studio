import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { EditDraft, SwapDraft } from "../lib/persistence.ts";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  },
});

const {
  clearLocalData,
  clearRun,
  draftAssetIds,
  readEditDraft,
  readRun,
  readSwapDraft,
  takePendingSource,
  takeRecipe,
  writeEditDraft,
  writePendingSource,
  writeRecipe,
  writeRun,
  writeSwapDraft,
} = await import("../lib/persistence.ts");

after(() => {
  delete (globalThis as { window?: unknown }).window;
});

beforeEach(() => {
  store.clear();
});

const swapDraft: SwapDraft = {
  v: 1,
  videoId: "video-1",
  start: 1.5,
  frames: 90,
  removeBackground: false,
  description: "a dancer",
  role: "person",
  action: "dancing",
  soundscape: "club music",
  mode: "prompt",
  targetPrompt: "a dancer",
  point: null,
  maskMargin: "normal",
  referenceMode: "direct",
  selected: [1],
  transforms: { 1: { scale: 1, x: 0, y: 0 } },
  shortEdge: 768,
  seed: 42,
  holdPreset: "normal",
  pinKeyframes: true,
  promptText: "prompt",
  promptOverride: false,
};

const editDraft: EditDraft = {
  v: 1,
  videoId: "video-2",
  start: 0,
  frames: 90,
  kind: "scene",
  change: "a beach",
  keep: "",
  style: "",
  soundscape: "",
  refs: [{ assetId: "asset-1", pin: 12, role: "background", roleLocked: true, caption: "sand" }],
  shortEdge: 768,
  seed: 7,
  holdPreset: "strong",
  pinKeyframes: false,
  promptText: "prompt",
  promptOverride: true,
};

test("round-trips both drafts", () => {
  writeSwapDraft(swapDraft);
  assert.deepEqual(readSwapDraft(), swapDraft);

  writeEditDraft(editDraft);
  assert.deepEqual(readEditDraft(), editDraft);
});

test("ignores drafts from an unknown version", () => {
  store.set("viggle:swap:draft", JSON.stringify({ v: 2 }));
  store.set("viggle:edit:draft", JSON.stringify({ v: 0 }));
  assert.equal(readSwapDraft(), null);
  assert.equal(readEditDraft(), null);
});

test("takes a pending source once", () => {
  writePendingSource("asset-9");
  assert.equal(takePendingSource(), "asset-9");
  assert.equal(takePendingSource(), null);
});

test("only takes a recipe for its own mode", () => {
  writeRecipe({
    mode: "edit",
    videoId: "video-2",
    start: 0,
    frames: 90,
    seed: 1,
    shortEdge: 768,
    prompt: "prompt",
    keyframeUntil: 0.9,
    pinKeyframes: false,
    refs: [],
  });
  assert.equal(takeRecipe("swap"), null);
  assert.notEqual(store.get("viggle:pending-recipe"), undefined);
  assert.equal(takeRecipe("edit")?.mode, "edit");
  assert.equal(takeRecipe("edit"), null);
});

test("collects assets from drafts, the pending source and a pending recipe", () => {
  writeSwapDraft(swapDraft);
  writeEditDraft(editDraft);
  writePendingSource("asset-pending");
  writeRecipe({
    mode: "edit",
    videoId: "video-recipe",
    start: 0,
    frames: 90,
    seed: 1,
    shortEdge: 768,
    prompt: "prompt",
    keyframeUntil: 0.9,
    pinKeyframes: false,
    refs: [{ assetId: "asset-recipe", pin: 0 }],
  });

  const ids = draftAssetIds();
  for (const id of ["video-1", "video-2", "asset-1", "asset-pending", "video-recipe", "asset-recipe"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(takePendingSource(), "asset-pending");
});

test("clears drafts, runs and pending hand-off data", () => {
  writeSwapDraft(swapDraft);
  writeEditDraft(editDraft);
  writePendingSource("asset-pending");
  writeRun("swap", { jobId: "job-1", videoId: "video-1", start: 0, frames: 90 });
  clearLocalData();
  assert.equal(readSwapDraft(), null);
  assert.equal(readEditDraft(), null);
  assert.equal(readRun("swap"), null);
  assert.equal(takePendingSource(), null);
  assert.equal(store.size, 0);
});

test("round-trips and clears the active run", () => {
  const run = { jobId: "job-1", videoId: "video-1", start: 0, frames: 90, prompt: "prompt" };
  writeRun("swap", run);
  assert.deepEqual(readRun("swap"), run);
  assert.equal(readRun("edit"), null);
  clearRun("swap");
  assert.equal(readRun("swap"), null);
});
