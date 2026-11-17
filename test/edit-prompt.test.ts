import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditPrompt,
  editDefaultRole,
  editKindInfo,
  isBareImageRequest,
  type EditKind,
  type EditRef,
} from "../lib/edit-prompt.ts";

const base = { keep: "", style: "", frames: 90, soundscape: "" };

function prompt(kind: EditKind, change: string, refs: EditRef[] = []) {
  return buildEditPrompt({ kind, change, refs, ...base });
}

test("keeps the user's request verbatim", () => {
  const request = "change the background to the image but keep the daylight and remove the crowd";
  const text = prompt("scene", request);
  assert.ok(text.includes(request));
});

test("recognises requests that only point at a picture", () => {
  assert.equal(isBareImageRequest("change the background to the image"), true);
  assert.equal(isBareImageRequest("use this picture"), true);
  assert.equal(isBareImageRequest("please apply the photo"), true);
  assert.equal(isBareImageRequest("a sunlit beach"), false);
  assert.equal(isBareImageRequest("change the background to the image but keep the daylight"), false);
});

test("replaces a bare image request with the reference caption", () => {
  const text = prompt("scene", "change the background to the image", [
    { role: "background", caption: "a quiet pebble beach at dusk" },
  ]);
  assert.ok(text.includes("a quiet pebble beach at dusk"));
  assert.ok(!text.includes("change the background to the image"));
  assert.ok(text.includes("The new setting is the one shown in <Picture 1>."));
});

test("falls back to the caption when the request is empty", () => {
  const text = prompt("scene", "", [{ role: "background", caption: "a pine forest in fog" }]);
  assert.ok(text.includes("a pine forest in fog"));
});

test("uses each kind's default keep when the user gives none", () => {
  for (const kind of ["remove", "add", "replace", "scene", "atmosphere", "style"] as const) {
    const text = prompt(kind, "a concrete change");
    assert.ok(text.includes(editKindInfo(kind).defaultKeep), kind);
  }
  assert.ok(!prompt("add", "a red car").includes("the background and every other person and object are copied frame for frame"));
});

test("retention follows the kind of edit", () => {
  assert.ok(prompt("add", "a red car").includes("<Subject 2> (appears in [Shot 1]): new - "));
  assert.ok(prompt("remove", "a watermark").includes("<Subject 2> (appears in [Shot 1]): removed - "));
  assert.ok(prompt("scene", "a beach").includes("<Subject 2> (appears in [Shot 1]): replaced - "));
  assert.ok(prompt("atmosphere", "storm light").includes("<Subject 2> (appears in [Shot 1]): changed - "));
});

test("describes every reference role and its retention", () => {
  const text = prompt("scene", "a sunlit beach", [
    { role: "background", caption: "wide sand and palm trees" },
    { role: "object", caption: "a red umbrella" },
    { role: "style", caption: "warm film grain" },
    { role: "frame", pin: 12 },
  ]);
  assert.ok(text.includes("<Picture 1> is a reference image of the new background and setting. It shows: wide sand and palm trees"));
  assert.ok(text.includes("<Picture 2> is a reference image of the new appearance to use. It shows: a red umbrella"));
  assert.ok(text.includes("<Picture 3> is a style reference image. It shows: warm film grain"));
  assert.ok(text.includes("<Picture 4> is a frame of the target video"));
  assert.ok(text.includes("<Picture 1> (background reference): reference - "));
  assert.ok(text.includes("<Picture 2> (object reference): reference - "));
  assert.ok(text.includes("<Picture 3> (style reference): reference - "));
  assert.ok(text.includes("<Picture 4> (target keyframe): fully_preserved - the target video passes through this exact frame at 00:00.500."));
  assert.ok(text.includes("The target video passes through <Picture 4> at 00:00.500."));
});

test("distinguishes pinned frames from unpinned edited frames", () => {
  const text = prompt("remove", "a watermark", [{ role: "frame" }]);
  assert.ok(text.includes("<Picture 1> is an edited source frame showing the target look."));
  assert.ok(text.includes("<Picture 1> (edited source frame): reference - "));
  assert.ok(!text.includes("target keyframe"));
});

test("anchors the edit to the matching reference role", () => {
  assert.ok(prompt("remove", "a watermark", [{ role: "object" }])
    .includes("The element to remove is the one shown in <Picture 1>."));
  assert.ok(prompt("atmosphere", "storm light", [{ role: "style" }])
    .includes("The new weather and light are shown in <Picture 1>."));
});

test("always writes the six prompt sections", () => {
  const text = prompt("remove", "a watermark");
  for (const section of [
    "subject_definitions",
    "summary",
    "retention_analysis",
    "detailed_description",
    "overall_soundscape",
    "non_diegetic_music",
  ]) {
    assert.ok(text.includes(section), section);
  }
});

test("omits picture tokens when there are no references", () => {
  assert.ok(!prompt("remove", "a watermark").includes("<Picture"));
});

test("picks the default reference role for each kind", () => {
  assert.equal(editDefaultRole("scene"), "background");
  assert.equal(editDefaultRole("atmosphere"), "style");
  assert.equal(editDefaultRole("style"), "style");
  assert.equal(editDefaultRole("remove"), "object");
  assert.equal(editDefaultRole("add"), "object");
  assert.equal(editDefaultRole("replace"), "object");
});
