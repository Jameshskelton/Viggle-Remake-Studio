import test from "node:test";
import assert from "node:assert/strict";
import { sigmaSchedule } from "../lib/sampling.ts";
import {
  DEFAULT_HOLD_PRESET,
  holdPresets,
  holdSteps,
  holdThreshold,
  nearestHoldPreset,
} from "../lib/keyframe-hold.ts";

test("lower thresholds hold the pinned frame for more steps", () => {
  for (const mode of ["swap", "edit"] as const) {
    assert.equal(holdSteps(holdThreshold("light"), mode), 2, `${mode} light`);
    assert.equal(holdSteps(holdThreshold("normal"), mode), 4, `${mode} normal`);
    assert.equal(holdSteps(holdThreshold("strong"), mode), 6, `${mode} strong`);
  }
});

test("presets expose thresholds and hints for both modes", () => {
  assert.equal(holdThreshold("light"), 0.98);
  assert.equal(holdThreshold("normal"), 0.9);
  assert.equal(holdThreshold("strong"), 0.5);
  assert.equal(DEFAULT_HOLD_PRESET, "normal");

  for (const mode of ["swap", "edit"] as const) {
    const presets = holdPresets(mode);
    assert.deepEqual(presets.map((preset) => preset.id), ["light", "normal", "strong"]);
    assert.equal(presets[1].hint, "4 of 6 sampling steps keep the pinned frame.");
  }
});

test("follows the configured step count", () => {
  const presets = holdPresets("swap", 8);
  assert.match(presets[1].hint, /of 8 sampling steps/);
  assert.equal(holdSteps(0.9, "swap", 8), sigmaSchedule("swap", 8).filter((sigma) => sigma >= 0.9).length);
});

test("maps a stored threshold back to the nearest preset", () => {
  assert.equal(nearestHoldPreset(0.98), "light");
  assert.equal(nearestHoldPreset(0.95), "light");
  assert.equal(nearestHoldPreset(0.9), "normal");
  assert.equal(nearestHoldPreset(0.6), "strong");
  assert.equal(nearestHoldPreset(0), "strong");
});
