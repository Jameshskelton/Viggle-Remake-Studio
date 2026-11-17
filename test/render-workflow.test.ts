import test from "node:test";
import assert from "node:assert/strict";
import { EDIT_SIGMAS, SWAP_SIGMAS } from "../lib/config.ts";
import { buildRenderGraph } from "../lib/render-workflow.ts";
import type { AppSettings } from "../lib/model-settings.ts";

const settings: AppSettings = {
  swapDiffusion: "swap-merged.safetensors",
  swapBase: "swap-base.safetensors",
  swapLoras: [],
  editBase: "edit-base.safetensors",
  editLoras: [{ name: "edit-lora.safetensors", strength: 1 }],
  textEncoder: "text.safetensors",
  videoVae: "video-vae.safetensors",
  audioVae: "audio-vae.safetensors",
  swapSteps: 6,
  editSteps: 6,
};

function graphFor(mode: "swap" | "edit", override: Partial<AppSettings> = {}) {
  return buildRenderGraph({
    mode,
    settings: { ...settings, ...override },
    clipInput: "viggle-studio/abcdef12/clip.mp4",
    refs: mode === "swap" ? [{ input: "viggle-studio/abcdef12/ref_1.png", pin: 0 }] : [],
    frames: 90,
    prompt: "prompt",
    shortEdge: 480,
    seed: 1,
    hasAudio: false,
    key: "abcdef12",
    keyframeUntil: 0.9,
    pinKeyframes: mode === "swap",
  });
}

function hasLora(graph: ReturnType<typeof buildRenderGraph>) {
  return Object.values(graph).some((node) => node.class_type === "LoraLoaderBypassModelOnly");
}

test("swap uses the selected merged diffusion model without LoRAs", () => {
  const graph = graphFor("swap");
  assert.equal(graph["1"].class_type, "UNETLoader");
  assert.equal(graph["1"].inputs.unet_name, "swap-merged.safetensors");
  assert.equal(hasLora(graph), false);
  assert.deepEqual(graph["3"].inputs.model, ["1", 0]);
  assert.equal(graph["4"].inputs.clip_name, "text.safetensors");
  assert.equal(graph["5"].inputs.vae_name, "video-vae.safetensors");
  assert.equal(graph["6"].inputs.vae_name, "audio-vae.safetensors");
});

test("swap chains every selected LoRA on the base model", () => {
  const graph = graphFor("swap", {
    swapLoras: [
      { name: "first.safetensors", strength: 1 },
      { name: "second.safetensors", strength: 0.5 },
    ],
  });
  assert.equal(graph["1"].inputs.unet_name, "swap-base.safetensors");
  assert.equal(graph["30"].class_type, "LoraLoaderBypassModelOnly");
  assert.equal(graph["30"].inputs.lora_name, "first.safetensors");
  assert.deepEqual(graph["30"].inputs.model, ["1", 0]);
  assert.equal(graph["31"].inputs.lora_name, "second.safetensors");
  assert.equal(graph["31"].inputs.strength_model, 0.5);
  assert.deepEqual(graph["31"].inputs.model, ["30", 0]);
  assert.deepEqual(graph["3"].inputs.model, ["31", 0]);
});

test("edit uses its own base model and LoRA chain", () => {
  const graph = graphFor("edit");
  assert.equal(graph["1"].inputs.unet_name, "edit-base.safetensors");
  assert.equal(graph["30"].class_type, "LoraLoaderBypassModelOnly");
  assert.equal(graph["30"].inputs.lora_name, "edit-lora.safetensors");
  assert.deepEqual(graph["3"].inputs.model, ["30", 0]);
});

test("edit can run without a LoRA for a plain base-model render", () => {
  const graph = graphFor("edit", { editLoras: [] });
  assert.equal(graph["1"].inputs.unet_name, "edit-base.safetensors");
  assert.equal(hasLora(graph), false);
  assert.deepEqual(graph["3"].inputs.model, ["1", 0]);
});

test("uses the configured sampling steps", () => {
  const swap = graphFor("swap");
  assert.equal(swap["12"].inputs.sigmas, SWAP_SIGMAS);
  assert.equal(swap["12"]._meta?.title, "Sigmas (swap, 6 steps)");

  const edit = graphFor("edit");
  assert.equal(edit["12"].inputs.sigmas, EDIT_SIGMAS);

  const eight = graphFor("swap", { swapSteps: 8 });
  assert.equal(String(eight["12"].inputs.sigmas).split(",").length, 9);
  assert.equal(eight["12"]._meta?.title, "Sigmas (swap, 8 steps)");

  const four = graphFor("edit", { editSteps: 4 });
  assert.equal(String(four["12"].inputs.sigmas).split(",").length, 5);
  assert.equal(four["12"]._meta?.title, "Sigmas (edit, 4 steps)");
});
