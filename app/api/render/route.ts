import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assetFile, getAsset } from "../../../lib/assets.ts";
import { saveJob } from "../../../lib/jobs.ts";
import { copyIntoComfy } from "../../../lib/ffmpeg.ts";
import { prepareClip } from "../../../lib/clips.ts";
import { buildRenderGraph, type RenderMode } from "../../../lib/render-workflow.ts";
import { queuePrompt } from "../../../lib/comfy.ts";
import { validFrameCount } from "../../../lib/config.ts";
import { loadSettings } from "../../../lib/settings.ts";
import { missingPromptSections } from "../../../lib/render-validation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefInput = { assetId: string; pin: number };

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      videoId?: string;
      start?: number;
      frames?: number;
      refs?: RefInput[];
      prompt?: string;
      shortEdge?: number;
      seed?: number;
      keyframeUntil?: number;
      pinKeyframes?: boolean;
      mode?: RenderMode;
      referenceMode?: "direct" | "keyframes";
    };
    const mode: RenderMode = body.mode === "edit" ? "edit" : "swap";
    const asset = body.videoId ? await getAsset(body.videoId) : null;
    if (!asset || asset.kind !== "video") return NextResponse.json({ error: "Upload a source video first." }, { status: 400 });
    const frames = Number(body.frames);
    if (!validFrameCount(frames)) return NextResponse.json({ error: "The clip must be 17n+5 frames from 90 to 345." }, { status: 400 });
    const start = Number(body.start ?? 0);
    if (!Number.isFinite(start) || start < 0) return NextResponse.json({ error: "The start time is invalid." }, { status: 400 });
    const refs = Array.isArray(body.refs) ? body.refs : [];
    if (refs.length > 4 || (mode === "swap" && refs.length < 1)) {
      return NextResponse.json({ error: mode === "edit" ? "Add up to 4 reference images." : "Add 1-4 painted keyframes." }, { status: 400 });
    }
    const pinKeyframes = body.pinKeyframes ?? mode === "swap";
    for (const ref of refs) {
      if (pinKeyframes && (!Number.isInteger(ref.pin) || ref.pin < 0 || ref.pin >= frames)) {
        return NextResponse.json({ error: mode === "edit" ? "Each pinned reference needs a pin inside the clip." : "Each painted keyframe needs a pin inside the clip." }, { status: 400 });
      }
      const refAsset = await getAsset(ref.assetId);
      if (!refAsset || refAsset.kind !== "image") {
        return NextResponse.json({ error: mode === "edit" ? "A reference image is missing." : "A painted keyframe is missing." }, { status: 400 });
      }
    }
    const prompt = String(body.prompt ?? "").trim();
    const missingSections = missingPromptSections(prompt);
    if (missingSections.length) {
      return NextResponse.json({ error: `The prompt is missing these sections: ${missingSections.join(", ")}.` }, { status: 400 });
    }
    const shortEdge = Number(body.shortEdge ?? 480);
    if (shortEdge !== 480 && shortEdge !== 736) return NextResponse.json({ error: "Choose 480p or 736p." }, { status: 400 });
    const seed = Number(body.seed ?? 0);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) return NextResponse.json({ error: "Seed is invalid." }, { status: 400 });
    const keyframeUntil = Number(body.keyframeUntil ?? 0.9);
    if (!(keyframeUntil >= 0 && keyframeUntil <= 1)) {
      return NextResponse.json({ error: "Keyframe hold must be between 0 and 1." }, { status: 400 });
    }
    const key = randomUUID().slice(0, 8);
    const clip = await prepareClip(asset, start, frames);
    const clipInput = await copyIntoComfy(clip.file, `viggle-studio/${key}`, "clip.mp4");

    const refInputs: Array<{ input: string; pin: number }> = [];
    for (const [i, ref] of refs.entries()) {
      const refAsset = (await getAsset(ref.assetId))!;
      const ext = path.extname(assetFile(refAsset)).replace(/^\./, "") || "png";
      const input = await copyIntoComfy(assetFile(refAsset), `viggle-studio/${key}`, `ref_${i + 1}.${ext}`);
      refInputs.push({ input, pin: ref.pin });
    }

    const settings = await loadSettings();
    const graph = buildRenderGraph({
      mode,
      settings,
      clipInput,
      refs: refInputs,
      frames,
      prompt,
      shortEdge,
      seed,
      hasAudio: asset.hasAudio ?? true,
      key,
      keyframeUntil,
      pinKeyframes,
    });
    const id = await queuePrompt(graph);
    await saveJob({
      id,
      kind: "render",
      mode,
      referenceMode: body.referenceMode === "keyframes" ? "keyframes" : body.referenceMode === "direct" ? "direct" : undefined,
      createdAt: Date.now(),
      status: "queued",
      error: null,
      assetId: asset.id,
      start: clip.start,
      frames,
      clipInput,
      promptId: id,
      progressNode: "13",
      nodeKeys: { video: "17" },
      refs,
      prompt,
      shortEdge,
      seed,
      keyframeUntil,
      pinKeyframes,
    });
    return NextResponse.json({ id, frames });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to start the render." }, { status: 502 });
  }
}
