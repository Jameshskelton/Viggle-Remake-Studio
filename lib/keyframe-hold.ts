import { DEFAULT_SAMPLING_STEPS } from "./model-settings.ts";
import { sigmaSchedule } from "./sampling.ts";

export type HoldPresetId = "light" | "normal" | "strong";

export type HoldPreset = {
  id: HoldPresetId;
  label: string;
  threshold: number;
  hint: string;
};

// Viggle Remake drops pinned keyframes once sigma falls below the threshold, so a
// LOWER threshold keeps them for MORE sampling steps. These presets are named by
// the effect, not by the number.
const PRESETS: Array<{ id: HoldPresetId; label: string; threshold: number }> = [
  { id: "light", label: "Light", threshold: 0.98 },
  { id: "normal", label: "Normal", threshold: 0.9 },
  { id: "strong", label: "Strong", threshold: 0.5 },
];

export const DEFAULT_HOLD_PRESET: HoldPresetId = "normal";

export function holdThreshold(id: HoldPresetId) {
  return PRESETS.find((preset) => preset.id === id)?.threshold ?? 0.9;
}

export function holdSteps(threshold: number, mode: "swap" | "edit", steps = DEFAULT_SAMPLING_STEPS) {
  return sigmaSchedule(mode, steps).filter((sigma) => sigma >= threshold).length;
}

export function holdPresets(mode: "swap" | "edit", steps = DEFAULT_SAMPLING_STEPS): HoldPreset[] {
  const total = sigmaSchedule(mode, steps).length - 1;
  return PRESETS.map((preset) => ({
    ...preset,
    hint: `${holdSteps(preset.threshold, mode, steps)} of ${total} sampling steps keep the pinned frame.`,
  }));
}

export function nearestHoldPreset(threshold: number): HoldPresetId {
  return PRESETS
    .slice()
    .sort((a, b) => Math.abs(a.threshold - threshold) - Math.abs(b.threshold - threshold))[0].id;
}
