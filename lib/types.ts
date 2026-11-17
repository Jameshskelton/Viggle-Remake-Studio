export type AssetKind = "video" | "image";

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  frames?: number;
  hasAudio?: boolean;
};

export type JobKind = "mask" | "render" | "cutout" | "caption";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type OutputFile = { filename: string; subfolder: string; type: string };

export type JobRecord = {
  id: string;
  kind: JobKind;
  mode?: "swap" | "edit";
  referenceMode?: "direct" | "keyframes";
  createdAt: number;
  status: JobStatus;
  finishedAt?: number;
  error?: string | null;
  assetId: string;
  start: number;
  frames: number;
  clipInput?: string;
  promptId?: string;
  progressNode?: string;
  nodeKeys?: { frames?: string; masks?: string; preview?: string; video?: string; image?: string; caption?: string };
  output?: OutputFile | null;
  preview?: OutputFile | null;
  resultAssetId?: string;
  resultText?: string;
  frameFiles?: OutputFile[];
  maskFiles?: OutputFile[];
  refs?: { assetId: string; pin: number }[];
  prompt?: string;
  shortEdge?: number;
  seed?: number;
  keyframeUntil?: number;
  pinKeyframes?: boolean;
};

export type SelectionMode = "prompt" | "manual";

export type MaskMargin = "tight" | "normal" | "loose";

export type ManualPoint = { x: number; y: number };

export type JobProgress = {
  value: number;
  max: number;
  startedAt?: number;
  firstAt?: number;
};

export type JobView = {
  id: string;
  kind: JobKind;
  mode?: "swap" | "edit";
  status: JobStatus;
  finishedAt?: number;
  queuePosition: number | null;
  queue?: { running: number; pending: number };
  progress?: JobProgress;
  error: string | null;
  elapsed: number;
  frames: number;
  previewUrl?: string;
  outputUrl?: string;
  resultAssetId?: string;
  resultText?: string;
  frameCount?: number;
  maskCount?: number;
};

export type JobSummary = {
  id: string;
  kind: JobKind;
  mode?: "swap" | "edit";
  referenceMode?: "direct" | "keyframes";
  status: JobStatus;
  progress?: JobProgress;
  createdAt: number;
  finishedAt?: number;
  frames: number;
  start: number;
  assetId: string;
  shortEdge?: number;
  seed?: number;
  keyframeUntil?: number;
  pinKeyframes?: boolean;
  refs?: { assetId: string; pin: number }[];
  prompt?: string;
  error?: string | null;
  outputUrl?: string;
  resultAssetId?: string;
};
