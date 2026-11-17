import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CLIP_DIR, COMFYUI_INPUT_DIR, COMFYUI_URL } from "./config.ts";

const exec = promisify(execFile);

export type VideoInfo = {
  width: number;
  height: number;
  duration: number;
  fps: number;
  frames: number;
  hasAudio: boolean;
};

export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await exec("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      duration?: string;
      nb_frames?: string;
    }>;
  };
  const video = (data.streams ?? []).find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("That file has no video stream.");
  const rate = video.avg_frame_rate && video.avg_frame_rate !== "0/0" ? video.avg_frame_rate : video.r_frame_rate ?? "24/1";
  const [num, den] = rate.split("/").map(Number);
  const fps = den ? num / den : 24;
  // The container duration can outrun the video stream when the audio track is longer.
  // The working clip follows the video, so derive the timeline from the video stream.
  const streamDuration = Number(video.duration ?? 0);
  const countedDuration = video.nb_frames && fps ? Number(video.nb_frames) / fps : 0;
  const duration = streamDuration > 0 ? streamDuration : countedDuration > 0 ? countedDuration : Number(data.format?.duration ?? 0);
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    duration,
    fps,
    // The working clip runs at 24 fps, so this is the number of frames on the render timeline.
    frames: Math.max(1, Math.round(duration * 24)),
    hasAudio: (data.streams ?? []).some((stream) => stream.codec_type === "audio"),
  };
}

// Cut a 24 fps working clip of exactly `frames` frames, preserving the source resolution.
// If the requested window runs past the source, the source loops to fill it. This means a
// twitchy 2 s test clip still works with any selected render length.
export async function makeClip(
  input: string,
  start: number,
  frames: number,
  output: string,
  hasAudio: boolean,
  duration?: number,
) {
  await mkdir(path.dirname(output), { recursive: true });
  const sourceDuration = duration ?? (await probeVideo(input)).duration;
  const window = frames / 24;
  const safeStart = Math.max(0, Math.min(start, Math.max(0, sourceDuration - 1 / 24)));
  const looped = safeStart + window > sourceDuration + 0.01;
  const args = ["-y"];
  if (looped) args.push("-stream_loop", "-1");
  args.push(
    "-ss", String(safeStart),
    "-i", input,
    "-vf", "fps=24,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-frames:v", String(frames),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "16",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-t", window.toFixed(6),
  );
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
  args.push(output);
  await exec("ffmpeg", args, { maxBuffer: 16 * 1024 * 1024 });
  return { start: safeStart, looped };
}

export async function padTransparentPng(bytes: Uint8Array, margin = 0.12) {
  await mkdir(CLIP_DIR, { recursive: true });
  const id = randomUUID();
  const input = path.join(CLIP_DIR, `${id}-cutout-in.png`);
  const output = path.join(CLIP_DIR, `${id}-cutout-out.png`);
  await writeFile(input, bytes);
  try {
    const scale = (1 + Math.max(0, Math.min(0.5, margin)) * 2).toFixed(4);
    await exec("ffmpeg", [
      "-y", "-v", "error",
      "-i", input,
      "-vf", `pad=iw*${scale}:ih*${scale}:(ow-iw)/2:(oh-ih)/2:color=#00000000`,
      "-frames:v", "1",
      output,
    ]);
    return new Uint8Array(await readFile(output));
  } finally {
    await Promise.all([rm(input, { force: true }), rm(output, { force: true })]);
  }
}

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._/-]+/g, "_").replace(/\.\./g, "_").replace(/^\/+/, "");
}

// Fast path: copy straight into ComfyUI/input. Otherwise upload through /upload/image.
export async function copyIntoComfy(file: string, subfolder: string, filename: string) {
  const folder = safePart(subfolder);
  const name = safePart(filename);
  if (COMFYUI_INPUT_DIR) {
    const target = path.join(COMFYUI_INPUT_DIR, folder, name);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
    return `${folder}/${name}`;
  }
  const body = new FormData();
  const bytes = await readFile(file);
  body.append("image", new Blob([new Uint8Array(bytes)]), name);
  body.append("subfolder", folder);
  body.append("type", "input");
  body.append("overwrite", "true");
  const response = await fetch(`${COMFYUI_URL}/upload/image`, { method: "POST", body });
  if (!response.ok) throw new Error(`ComfyUI rejected the upload (${response.status}).`);
  const result = await response.json() as { name?: string; subfolder?: string };
  return `${result.subfolder ? `${result.subfolder}/` : ""}${result.name ?? name}`;
}
