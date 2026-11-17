export type LoraSelection = { name: string; strength: number };

export type ModelSettings = {
  swapDiffusion: string;
  swapBase: string;
  swapLoras: LoraSelection[];
  editBase: string;
  editLoras: LoraSelection[];
  textEncoder: string;
  videoVae: string;
  audioVae: string;
};

export type SamplingSettings = {
  swapSteps: number;
  editSteps: number;
};

export type AppSettings = ModelSettings & SamplingSettings;

export const MIN_SAMPLING_STEPS = 1;
export const MAX_SAMPLING_STEPS = 16;
export const DEFAULT_SAMPLING_STEPS = 6;

export const MODEL_SETTINGS_KEYS = [
  "swapDiffusion",
  "swapBase",
  "editBase",
  "textEncoder",
  "videoVae",
  "audioVae",
] as const satisfies readonly (keyof ModelSettings)[];

export const MODEL_SETTINGS_LABELS: Record<keyof ModelSettings, string> = {
  swapDiffusion: "Swap diffusion model",
  swapBase: "Swap base model",
  swapLoras: "Swap LoRAs",
  editBase: "Edit base diffusion model",
  editLoras: "Edit LoRAs",
  textEncoder: "Text encoder",
  videoVae: "Video VAE",
  audioVae: "Audio VAE",
};
