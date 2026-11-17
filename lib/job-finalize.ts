import { saveAsset } from "./assets.ts";
import { downloadComfyFile, outputFiles, type HistoryEntry } from "./comfy.ts";
import { clearProgress } from "./comfy-progress.ts";
import { CUTOUT_PADDING } from "./config.ts";
import { dateStamp } from "./datetime.ts";
import { padTransparentPng } from "./ffmpeg.ts";
import { getJob, runFinalization, saveJob } from "./jobs.ts";
import type { JobStatus } from "./types.ts";

async function finalize(id: string, entry: HistoryEntry | null) {
  const job = await getJob(id);
  if (!job) return;
  if (job.status !== "queued" && job.status !== "running") return;

  let status: JobStatus = "succeeded";
  let error: string | null = null;

  if (job.kind === "caption") {
    const node = job.nodeKeys?.caption ?? "4";
    const text = entry?.outputs?.[node]?.text?.[0];
    if (!text) {
      status = "failed";
      error = "The image description finished without text.";
    } else {
      job.resultText = String(text).trim();
    }
  } else if (job.kind === "cutout") {
    const images = entry?.outputs?.[job.nodeKeys?.image ?? "3"]?.images ?? [];
    const file = images.find((candidate) => /\.png$/i.test(candidate.filename)) ?? images[0] ?? null;
    if (!file) {
      status = "failed";
      error = "The background-removal job finished without an image.";
    } else {
      job.output = file;
      if (!job.resultAssetId) {
        try {
          const bytes = await downloadComfyFile(file);
          const padded = await padTransparentPng(bytes, CUTOUT_PADDING);
          const asset = await saveAsset(padded, `character-cutout-${dateStamp()}.png`, "image/png", "image");
          job.resultAssetId = asset.id;
        } catch (reason) {
          status = "failed";
          error = reason instanceof Error ? reason.message : "Could not import the background-removed image.";
        }
      }
    }
  } else if (job.kind === "render") {
    const files = outputFiles(entry);
    job.output = files.find((file) => /\.(mp4|webm|mkv|mov)$/i.test(file.filename)) ?? files[0] ?? null;
    if (!job.output) {
      status = "failed";
      error = "The render finished without a video file.";
    } else if (!job.resultAssetId) {
      try {
        const bytes = await downloadComfyFile(job.output);
        const ext = job.output.filename.split(".").pop() || "mp4";
        const name = `${job.mode === "edit" ? "edit" : "swap"}-${dateStamp()}.${ext}`;
        const asset = await saveAsset(bytes, name, "video/mp4", "video");
        job.resultAssetId = asset.id;
      } catch {
        // Keep the ComfyUI proxy as the fallback.
      }
    }
  } else {
    const nodeKeys = job.nodeKeys ?? {};
    const images = (node: string | undefined) => entry?.outputs?.[node ?? ""]?.images ?? [];
    const masks = images(nodeKeys.masks);
    const frames = images(nodeKeys.frames);
    const previews = [
      ...(entry?.outputs?.[nodeKeys.preview ?? ""]?.gifs ?? []),
      ...(entry?.outputs?.[nodeKeys.preview ?? ""]?.images ?? []),
      ...(entry?.outputs?.[nodeKeys.preview ?? ""]?.videos ?? []),
    ];
    job.preview = previews[0] ?? null;
    job.frameFiles = frames;
    job.maskFiles = masks;
    if (!frames.length || !masks.length) {
      status = "failed";
      error = "The mask job finished without frames. Check the ComfyUI console.";
    }
  }

  const finished = status === "succeeded" || status === "failed" || status === "cancelled";
  job.status = status;
  job.error = error;
  job.finishedAt = finished ? (job.finishedAt ?? Date.now()) : undefined;
  if (finished) clearProgress(id);
  await saveJob(job);
}

export function finalizeCompletedJob(id: string, entry: HistoryEntry | null) {
  return runFinalization(id, () => finalize(id, entry));
}
