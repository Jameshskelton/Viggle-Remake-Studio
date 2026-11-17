import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, EDIT_WEIGHTS, WEIGHTS } from "./config.ts";
import {
  DEFAULT_SAMPLING_STEPS,
  MAX_SAMPLING_STEPS,
  MIN_SAMPLING_STEPS,
  MODEL_SETTINGS_KEYS,
  MODEL_SETTINGS_LABELS,
  type AppSettings,
  type LoraSelection,
} from "./model-settings.ts";

export const DEFAULT_SETTINGS: AppSettings = {
  swapDiffusion: WEIGHTS.diffusion,
  swapBase: WEIGHTS.baseModel,
  swapLoras: WEIGHTS.lora ? [{ name: WEIGHTS.lora, strength: 1 }] : [],
  editBase: EDIT_WEIGHTS.baseModel,
  editLoras: EDIT_WEIGHTS.lora ? [{ name: EDIT_WEIGHTS.lora, strength: 1 }] : [],
  textEncoder: WEIGHTS.textEncoder,
  videoVae: WEIGHTS.videoVae,
  audioVae: WEIGHTS.audioVae,
  swapSteps: DEFAULT_SAMPLING_STEPS,
  editSteps: DEFAULT_SAMPLING_STEPS,
};

const REQUIRED = new Set<string>([
  "swapDiffusion",
  "swapBase",
  "editBase",
  "textEncoder",
  "videoVae",
  "audioVae",
]);

export const SETTINGS_FILE = path.join(/* turbopackIgnore: true */ DATA_DIR, "settings.json");

function sanitizeName(value: unknown, fallback: string, required: boolean) {
  if (typeof value !== "string") return fallback;
  const name = value.trim();
  if (!name) return required ? fallback : "";
  if (name.length > 300 || /[\u0000-\u001f]/.test(name)) return fallback;
  return name;
}

function parseLoras(primary: unknown, legacy: unknown, fallback: LoraSelection[]): LoraSelection[] {
  if (Array.isArray(primary)) {
    const loras: LoraSelection[] = [];
    for (const entry of primary) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const name = sanitizeName(record.name, "", false);
      if (!name) continue;
      const rawStrength = Number(record.strength ?? 1);
      const strength = Number.isFinite(rawStrength) ? Math.max(-2, Math.min(2, rawStrength)) : 1;
      loras.push({ name, strength });
    }
    return loras;
  }
  if (typeof legacy === "string") {
    const name = sanitizeName(legacy, "", false);
    return name ? [{ name, strength: 1 }] : [];
  }
  return fallback.map((lora) => ({ ...lora }));
}

function parseSteps(value: unknown, fallback: number) {
  const steps = Number(value);
  return Number.isInteger(steps) && steps >= MIN_SAMPLING_STEPS && steps <= MAX_SAMPLING_STEPS ? steps : fallback;
}

export async function loadSettings(): Promise<AppSettings> {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(SETTINGS_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch {
    // Use the environment-derived defaults when the file is missing or unreadable.
  }

  return {
    swapDiffusion: sanitizeName(stored.swapDiffusion, DEFAULT_SETTINGS.swapDiffusion, true),
    swapBase: sanitizeName(stored.swapBase, DEFAULT_SETTINGS.swapBase, true),
    swapLoras: parseLoras(stored.swapLoras, stored.swapLora, DEFAULT_SETTINGS.swapLoras),
    editBase: sanitizeName(stored.editBase, DEFAULT_SETTINGS.editBase, true),
    editLoras: parseLoras(stored.editLoras, stored.editLora, DEFAULT_SETTINGS.editLoras),
    textEncoder: sanitizeName(stored.textEncoder, DEFAULT_SETTINGS.textEncoder, true),
    videoVae: sanitizeName(stored.videoVae, DEFAULT_SETTINGS.videoVae, true),
    audioVae: sanitizeName(stored.audioVae, DEFAULT_SETTINGS.audioVae, true),
    swapSteps: parseSteps(stored.swapSteps, DEFAULT_SETTINGS.swapSteps),
    editSteps: parseSteps(stored.editSteps, DEFAULT_SETTINGS.editSteps),
  };
}

export async function saveSettings(input: Partial<Record<keyof AppSettings, unknown>>): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    ...current,
    swapLoras: current.swapLoras.map((lora) => ({ ...lora })),
    editLoras: current.editLoras.map((lora) => ({ ...lora })),
  };

  for (const key of MODEL_SETTINGS_KEYS) {
    if (!(key in input)) continue;
    const raw = input[key];
    if (typeof raw !== "string" || raw.length > 300 || /[\u0000-\u001f]/.test(raw)) {
      throw new Error(`${MODEL_SETTINGS_LABELS[key]} is not a valid model name.`);
    }
    const value = raw.trim();
    if (REQUIRED.has(key) && !value) {
      throw new Error(`${MODEL_SETTINGS_LABELS[key]} cannot be empty.`);
    }
    next[key] = value;
  }

  for (const key of ["swapLoras", "editLoras"] as const) {
    if (!(key in input)) continue;
    const raw = input[key];
    if (!Array.isArray(raw)) {
      throw new Error(`${MODEL_SETTINGS_LABELS[key]} must be a list.`);
    }
    next[key] = raw.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`LoRA ${index + 1} is invalid.`);
      }
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name || name.length > 300 || /[\u0000-\u001f]/.test(name)) {
        throw new Error(`LoRA ${index + 1} needs a valid model name.`);
      }
      const strength = Number(record.strength ?? 1);
      if (!Number.isFinite(strength) || strength < -2 || strength > 2) {
        throw new Error(`LoRA ${index + 1} strength must be between -2 and 2.`);
      }
      return { name, strength };
    });
  }

  for (const key of ["swapSteps", "editSteps"] as const) {
    if (!(key in input)) continue;
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < MIN_SAMPLING_STEPS || value > MAX_SAMPLING_STEPS) {
      throw new Error(
        `${key === "swapSteps" ? "Swap" : "Edit"} sampling steps must be an integer from ${MIN_SAMPLING_STEPS} to ${MAX_SAMPLING_STEPS}.`,
      );
    }
    next[key] = value;
  }

  await mkdir(DATA_DIR, { recursive: true });
  const temp = path.join(/* turbopackIgnore: true */ DATA_DIR, `settings.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(next, null, 2));
    await rename(temp, SETTINGS_FILE);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return next;
}
