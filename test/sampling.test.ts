import test from "node:test";
import assert from "node:assert/strict";
import { EDIT_SIGMAS, SWAP_SIGMAS } from "../lib/config.ts";
import { clampSamplingSteps, sigmaSchedule } from "../lib/sampling.ts";

test("returns the model-card schedules unchanged at 6 steps", () => {
  assert.deepEqual(sigmaSchedule("swap", 6), SWAP_SIGMAS.split(",").map(Number));
  assert.deepEqual(sigmaSchedule("edit", 6), EDIT_SIGMAS.split(",").map(Number));
});

test("resamples the curve for other step counts", () => {
  for (const mode of ["swap", "edit"] as const) {
    for (const steps of [1, 3, 4, 8, 12, 16]) {
      const sigmas = sigmaSchedule(mode, steps);
      assert.equal(sigmas.length, steps + 1, `${mode} ${steps}`);
      assert.equal(sigmas[0], 1, `${mode} ${steps} first`);
      assert.equal(sigmas[sigmas.length - 1], 0, `${mode} ${steps} last`);
      for (let i = 1; i < sigmas.length; i++) {
        assert.ok(sigmas[i] <= sigmas[i - 1], `${mode} ${steps} descending at ${i}`);
      }
    }
  }
});

test("clamps out-of-range step counts", () => {
  assert.equal(sigmaSchedule("swap", 0).length, 2);
  assert.equal(sigmaSchedule("swap", 99).length, 17);
  assert.equal(clampSamplingSteps("nope"), 6);
  assert.equal(clampSamplingSteps(3.4), 3);
});
