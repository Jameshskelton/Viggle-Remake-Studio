import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAsset } from "../../../lib/assets.ts";
import { saveJob } from "../../../lib/jobs.ts";
import { copyIntoComfy } from "../../../lib/ffmpeg.ts";
import { prepareClip } from "../../../lib/clips.ts";
import { buildMaskGraph } from "../../../lib/mask-workflow.ts";
import { queuePrompt } from "../../../lib/comfy.ts";
import { validFrameCount } from "../../../lib/config.ts";
import { DEFAULT_MASK_MARGIN, MASK_MARGINS } from "../../../lib/margins.ts";
import type { ManualPoint, MaskMargin, SelectionMode } from "../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      videoId?: string;
      start?: number;
      frames?: number;
      mode?: SelectionMode;
      target?: string;
      point?: ManualPoint;
      margin?: MaskMargin;
    };
    const asset = body.videoId ? await getAsset(body.videoId) : null;
    if (!asset || asset.kind !== "video") return NextResponse.json({ error: "Upload a source video first." }, { status: 400 });
    const frames = Number(body.frames);
    if (!validFrameCount(frames)) return NextResponse.json({ error: "The clip must be 17n+5 frames from 90 to 345." }, { status: 400 });
    const start = Number(body.start ?? 0);
    if (!Number.isFinite(start) || start < 0) return NextResponse.json({ error: "The start time is invalid." }, { status: 400 });
    const margin: MaskMargin = body.margin && Object.hasOwn(MASK_MARGINS, body.margin) ? body.margin : DEFAULT_MASK_MARGIN;
    const mode: SelectionMode = body.mode === "manual" ? "manual" : "prompt";
    const point = body.point;
    if (mode === "manual" && (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return NextResponse.json({ error: "Click the character in the frame first." }, { status: 400 });
    }

    const key = randomUUID().slice(0, 8);
    const clip = await prepareClip(asset, start, frames);
    const clipInput = await copyIntoComfy(clip.file, `viggle-studio/${key}`, "clip.mp4");

    const graph = buildMaskGraph({
      clipInput,
      frames,
      mode,
      target: String(body.target ?? "person").slice(0, 120),
      point,
      width: asset.width ?? 1,
      height: asset.height ?? 1,
      key,
      margin,
    });

    const id = await queuePrompt(graph);
    await saveJob({
      id,
      kind: "mask",
      createdAt: Date.now(),
      status: "queued",
      error: null,
      assetId: asset.id,
      start: clip.start,
      frames,
      clipInput,
      promptId: id,
      progressNode: mode === "manual" ? "6" : "5",
      nodeKeys: { frames: "10", masks: "9", preview: "12" },
    });
    return NextResponse.json({ id, frames, clipId: clip.key, start: clip.start, looped: clip.looped, margin });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start the mask job." }, { status: 502 });
  }
}
