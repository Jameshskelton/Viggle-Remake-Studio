import path from "node:path";
import { MAX_FRAMES, MIN_FRAMES, FRAME_STEP } from "./frames.ts";

export { clipFrames, validFrameCount, secondsForFrames, frameOptions, candidateIndices, MIN_FRAMES, MAX_FRAMES, FRAME_STEP } from "./frames.ts";

export const COMFYUI_URL = (process.env.COMFYUI_URL ?? "http://127.0.0.1:8188").replace(/\/+$/, "");
export const COMFYUI_INPUT_DIR = (process.env.COMFYUI_INPUT_DIR ?? "").trim();
export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
export const ASSET_DIR = path.join(DATA_DIR, "assets");
export const JOB_DIR = path.join(DATA_DIR, "jobs");
export const CLIP_DIR = path.join(DATA_DIR, "clips");

export const WEIGHTS = {
  diffusion: process.env.VIGGLE_DIFFUSION_MODEL ?? "viggle_remake_swap_pruned_int8_convrot.safetensors",
  textEncoder: process.env.VIGGLE_TEXT_ENCODER ?? "qwen3vl_32b_minimax_h3_int4_convrot.safetensors",
  videoVae: process.env.VIGGLE_VIDEO_VAE ?? "minimax_h3_video_vae_int8_convrot.safetensors",
  audioVae: process.env.VIGGLE_AUDIO_VAE ?? "minimax_h3_audio_vae_fp32.safetensors",
  baseModel: process.env.VIGGLE_BASE_MODEL ?? "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  lora: (process.env.VIGGLE_LORA ?? "").trim(),
};

export const EDIT_WEIGHTS = {
  baseModel: process.env.VIGGLE_EDIT_BASE_MODEL ?? "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  lora: (process.env.VIGGLE_EDIT_LORA ?? "viggle_remake_edit_comfyui.safetensors").trim(),
};

export const SWAP_SIGMAS = "1.0, 0.990476, 0.965243, 0.923077, 0.8, 0.631579, 0.0";
export const EDIT_SIGMAS = "1.0, 0.983607, 0.96, 0.923077, 0.857143, 0.705882, 0.0";

export const SAM_CHECKPOINT = process.env.SAM_CHECKPOINT ?? "sam3.1_multiplex_fp16.safetensors";
export const CAPTION_MODEL = (process.env.CAPTION_MODEL ?? "Florence-2-large-PromptGen-v2.0").trim();
export const CUTOUT_MODEL = (process.env.BACKGROUND_REMOVAL_MODEL ?? "RMBG-1.4").trim();
const cutoutPadding = Number(process.env.BACKGROUND_REMOVAL_PADDING ?? 0.12);
export const CUTOUT_PADDING = Number.isFinite(cutoutPadding) ? Math.min(0.5, Math.max(0, cutoutPadding)) : 0.12;
export const UI_FRAME_SIZE = 1008;
