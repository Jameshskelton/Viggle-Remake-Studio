import type { AppSettings } from "./model-settings.ts";
import { sigmaSchedule } from "./sampling.ts";
import { dateStamp } from "./datetime.ts";

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }>;

export type RenderMode = "swap" | "edit";

export function buildRenderGraph(options: {
  mode?: RenderMode;
  clipInput: string;
  refs: Array<{ input: string; pin: number }>;
  frames: number;
  prompt: string;
  shortEdge: number;
  seed: number;
  hasAudio: boolean;
  key: string;
  keyframeUntil: number;
  pinKeyframes: boolean;
  settings: AppSettings;
}) {
  const mode = options.mode ?? "swap";
  const graph: Graph = {};
  const add = (id: string, class_type: string, title: string, inputs: Record<string, unknown>) => {
    graph[id] = { class_type, inputs, _meta: { title } };
    return id;
  };

  const loras = mode === "edit" ? options.settings.editLoras : options.settings.swapLoras;
  const baseModel = mode === "edit" ? options.settings.editBase : options.settings.swapBase;
  let modelId: string;
  if (mode === "edit" || loras.length > 0) {
    add("1", "UNETLoader", "Base model", { unet_name: baseModel, weight_dtype: "default" });
    modelId = "1";
    for (const [index, lora] of loras.entries()) {
      modelId = add(String(30 + index), "LoraLoaderBypassModelOnly", `LoRA ${index + 1}`, {
        model: [modelId, 0],
        lora_name: lora.name,
        strength_model: lora.strength,
      });
    }
  } else {
    modelId = add("1", "UNETLoader", "Viggle Remake transformer", { unet_name: options.settings.swapDiffusion, weight_dtype: "default" });
  }

  add("3", "RemakeKeyframeUntil", "Keyframe until", { model: [modelId, 0], keyframe_until: options.keyframeUntil });
  add("4", "CLIPLoader", "MiniMax H3 text encoder", { clip_name: options.settings.textEncoder, type: "minimax" });
  add("5", "VAELoader", "Video VAE", { vae_name: options.settings.videoVae });
  add("6", "VAELoader", "Audio VAE", { vae_name: options.settings.audioVae });
  add("7", "VHS_LoadVideo", "Source clip (24 fps)", {
    video: options.clipInput,
    force_rate: 24,
    custom_width: 0,
    custom_height: 0,
    frame_load_cap: options.frames,
    skip_first_frames: 0,
    select_every_nth: 1,
    format: "None",
  });

  let sourceRef: string | null = null;
  if (options.refs.length === 0 && mode === "edit") {
    sourceRef = add("18", "ImageFromBatch", "Source frame reference", { image: ["7", 0], batch_index: 0, length: 1 });
  }

  const conditioning: Record<string, unknown> = {
    clip: ["4", 0],
    vae: ["5", 0],
    audio_vae: ["6", 0],
    source: ["7", 0],
    prompt: options.prompt,
    ref_1: [sourceRef ?? String(20), 0],
    pins: options.pinKeyframes ? options.refs.map((ref) => ref.pin).join(", ") : "",
    frames: options.frames,
    short_edge: options.shortEdge,
  };
  if (options.hasAudio) conditioning.audio = ["7", 2];
  for (let i = 1; i < options.refs.length; i++) conditioning[`ref_${i + 1}`] = [String(20 + i), 0];

  add("8", "RemakeConditioning", "Viggle Remake Conditioning", conditioning);
  add("9", "RemakeNoise", "Starting noise", { positive: ["8", 0], seed: options.seed });
  add("10", "BasicGuider", "Guider", { model: ["3", 0], conditioning: ["8", 0] });
  add("11", "KSamplerSelect", "Sampler", { sampler_name: "euler" });
  const sigmas = sigmaSchedule(mode, mode === "edit" ? options.settings.editSteps : options.settings.swapSteps);
  add("12", "ManualSigmas", `Sigmas (${mode}, ${sigmas.length - 1} steps)`, {
    sigmas: sigmas.map((value) => (Number.isInteger(value) ? value.toFixed(1) : String(value))).join(", "),
  });
  add("13", "SamplerCustomAdvanced", "Sample", {
    noise: ["9", 0],
    guider: ["10", 0],
    sampler: ["11", 0],
    sigmas: ["12", 0],
    latent_image: ["8", 1],
  });
  add("14", "VAEDecode", "Decode video", { samples: ["13", 0], vae: ["5", 0] });
  add("15", "VAEDecodeAudio", "Decode audio", { samples: ["13", 0], vae: ["6", 0] });
  add("16", "CreateVideo", "Create video", { images: ["14", 0], audio: ["15", 0], fps: 24 });
  add("17", "SaveVideo", "Save video", {
    video: ["16", 0],
    filename_prefix: `viggle-studio/${options.key}/${mode === "edit" ? "edit" : "swap"}-${dateStamp()}`,
    format: "mp4",
    codec: "h264",
  });

  for (const [i, ref] of options.refs.entries()) {
    add(String(20 + i), "LoadImage", `Reference ${i + 1}`, { image: ref.input });
  }

  return graph;
}
