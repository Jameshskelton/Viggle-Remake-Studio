"use client";

import type { RenderMode } from "./render-workflow.ts";
import type { EditKind, EditRole } from "./edit-prompt.ts";
import type { HoldPresetId } from "./keyframe-hold.ts";
import type { ManualPoint, MaskMargin, SelectionMode } from "./types.ts";

export type StoredRun = {
  jobId: string;
  videoId: string;
  start: number;
  frames: number;
  prompt?: string;
};

export type RenderRecipe = {
  mode: RenderMode;
  referenceMode?: "direct" | "keyframes";
  videoId: string;
  start: number;
  frames: number;
  seed: number;
  shortEdge: number;
  prompt: string;
  keyframeUntil: number;
  pinKeyframes: boolean;
  refs: Array<{ assetId: string; pin: number }>;
};

const RUN_KEYS: Record<RenderMode, string> = {
  swap: "viggle:swap:run",
  edit: "viggle:edit:run",
};
const PENDING_SOURCE = "viggle:pending-source";
const PENDING_RECIPE = "viggle:pending-recipe";
const DRAFT_KEYS: Record<RenderMode, string> = {
  swap: "viggle:swap:draft",
  edit: "viggle:edit:draft",
};

export type SwapDraft = {
  v: 1;
  videoId?: string;
  start: number;
  frames: number;
  targetAssetId?: string;
  rawTargetAssetId?: string;
  removeBackground: boolean;
  description: string;
  role: string;
  action: string;
  soundscape: string;
  mode: SelectionMode;
  targetPrompt: string;
  point: ManualPoint | null;
  maskMargin: MaskMargin;
  maskJobId?: string;
  referenceMode: "direct" | "keyframes";
  selected: number[];
  transforms: Record<number, { scale: number; x: number; y: number; assetId?: string }>;
  shortEdge: number;
  seed: number;
  holdPreset: HoldPresetId;
  pinKeyframes: boolean;
  promptText: string;
  promptOverride: boolean;
};

export type EditDraft = {
  v: 1;
  videoId?: string;
  start: number;
  frames: number;
  kind: EditKind;
  change: string;
  keep: string;
  style: string;
  soundscape: string;
  refs: Array<{ assetId: string; pin: number; role: EditRole; roleLocked: boolean; caption?: string }>;
  shortEdge: number;
  seed: number;
  holdPreset: HoldPresetId;
  pinKeyframes: boolean;
  promptText: string;
  promptOverride: boolean;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = storage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable or full
  }
}

function remove(key: string) {
  try {
    storage()?.removeItem(key);
  } catch {
    // storage unavailable
  }
}

export function readRun(mode: RenderMode) {
  return read<StoredRun>(RUN_KEYS[mode]);
}

export function writeRun(mode: RenderMode, run: StoredRun) {
  write(RUN_KEYS[mode], run);
}

export function clearRun(mode: RenderMode) {
  remove(RUN_KEYS[mode]);
}

export function writePendingSource(assetId: string) {
  write(PENDING_SOURCE, assetId);
}

export function takePendingSource() {
  const value = read<string>(PENDING_SOURCE);
  remove(PENDING_SOURCE);
  return value;
}

export function writeRecipe(recipe: RenderRecipe) {
  write(PENDING_RECIPE, recipe);
}

export function takeRecipe(mode: RenderMode) {
  const value = read<RenderRecipe>(PENDING_RECIPE);
  if (!value || value.mode !== mode) return null;
  remove(PENDING_RECIPE);
  return value;
}

export function clearLocalData() {
  for (const key of Object.values(RUN_KEYS)) remove(key);
  for (const key of Object.values(DRAFT_KEYS)) remove(key);
  remove(PENDING_SOURCE);
  remove(PENDING_RECIPE);
}

export function draftAssetIds() {
  const ids = new Set<string>();
  const pending = read<string>(PENDING_SOURCE);
  if (pending) ids.add(pending);
  const recipe = read<RenderRecipe>(PENDING_RECIPE);
  if (recipe) {
    ids.add(recipe.videoId);
    for (const ref of recipe.refs) ids.add(ref.assetId);
  }
  const swap = readSwapDraft();
  if (swap) {
    for (const id of [swap.videoId, swap.targetAssetId, swap.rawTargetAssetId]) if (id) ids.add(id);
    for (const transform of Object.values(swap.transforms)) if (transform.assetId) ids.add(transform.assetId);
  }
  const edit = readEditDraft();
  if (edit) {
    if (edit.videoId) ids.add(edit.videoId);
    for (const ref of edit.refs) ids.add(ref.assetId);
  }
  return [...ids];
}

export function readSwapDraft() {
  const draft = read<SwapDraft>(DRAFT_KEYS.swap);
  return draft && draft.v === 1 ? draft : null;
}

export function writeSwapDraft(draft: SwapDraft) {
  write(DRAFT_KEYS.swap, draft);
}

export function readEditDraft() {
  const draft = read<EditDraft>(DRAFT_KEYS.edit);
  return draft && draft.v === 1 ? draft : null;
}

export function writeEditDraft(draft: EditDraft) {
  write(DRAFT_KEYS.edit, draft);
}
