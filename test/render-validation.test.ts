import test from "node:test";
import assert from "node:assert/strict";
import { missingPromptSections, PROMPT_SECTIONS } from "../lib/render-validation.ts";
import { validFrameCount } from "../lib/config.ts";
import { normalizeClipStart } from "../lib/clips.ts";

test("accepts a prompt that contains every section", () => {
  assert.deepEqual(missingPromptSections(PROMPT_SECTIONS.join("\n")), []);
});

test("lists the sections a prompt is missing", () => {
  assert.deepEqual(missingPromptSections("subject_definitions\nsummary"), [
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
  ]);
});

test("only accepts frame counts on the 24 fps grid", () => {
  assert.equal(validFrameCount(90), true);
  assert.equal(validFrameCount(107), true);
  assert.equal(validFrameCount(345), true);
  assert.equal(validFrameCount(91), false);
  assert.equal(validFrameCount(89), false);
  assert.equal(validFrameCount(346), false);
  assert.equal(validFrameCount(90.5), false);
});

test("clamps a requested start inside the source clip", () => {
  assert.equal(normalizeClipStart(2.813, 0), 0);
  assert.equal(normalizeClipStart(2.813, -4), 0);
  assert.ok(Math.abs(normalizeClipStart(2.813, 100) - (2.813 - 1 / 24)) < 1e-9);
  assert.equal(normalizeClipStart(0, 5), 0);
});
