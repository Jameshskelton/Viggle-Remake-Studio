import { EDIT_SIGMAS, SWAP_SIGMAS } from "./config.ts";
import {
  DEFAULT_SAMPLING_STEPS,
  MAX_SAMPLING_STEPS,
  MIN_SAMPLING_STEPS,
} from "./model-settings.ts";

function baseSchedule(mode: "swap" | "edit") {
  return (mode === "edit" ? EDIT_SIGMAS : SWAP_SIGMAS)
    .split(",")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export function clampSamplingSteps(value: unknown) {
  const steps = Number(value);
  if (!Number.isFinite(steps)) return DEFAULT_SAMPLING_STEPS;
  return Math.min(MAX_SAMPLING_STEPS, Math.max(MIN_SAMPLING_STEPS, Math.round(steps)));
}

// The model card ships a 6-step schedule. Other step counts sample the same
// curve in index space, so the first sigma is 1.0 and the last is 0.0.
export function sigmaSchedule(mode: "swap" | "edit", steps: number) {
  const base = baseSchedule(mode);
  const total = clampSamplingSteps(steps);
  if (total === base.length - 1) return base;

  const points = total + 1;
  const last = base.length - 1;
  const values = Array.from({ length: points }, (_, index) => {
    const position = (index * last) / (points - 1);
    const low = Math.floor(position);
    const high = Math.min(last, low + 1);
    const value = base[low] + (base[high] - base[low]) * (position - low);
    return Math.round(value * 1_000_000) / 1_000_000;
  });
  values[0] = 1;
  values[values.length - 1] = 0;
  return values;
}
