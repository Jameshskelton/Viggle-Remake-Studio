import { NextResponse } from "next/server";
import { getQueue, getSystemStats, listModels, queueCounts } from "../../../lib/comfy.ts";
import { CAPTION_MODEL, SAM_CHECKPOINT } from "../../../lib/config.ts";
import { loadSettings } from "../../../lib/settings.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [stats, models, queue, settings] = await Promise.all([
      getSystemStats(),
      listModels(),
      getQueue().catch(() => ({ queue_running: [], queue_pending: [] })),
      loadSettings(),
    ]);

    const swapModel = settings.swapLoras.length ? settings.swapBase : settings.swapDiffusion;
    const swapMissing = [
      ...(models.unets.includes(swapModel) ? [] : [swapModel]),
      ...settings.swapLoras.filter((lora) => !models.loras.includes(lora.name)).map((lora) => lora.name),
      ...(models.clips.includes(settings.textEncoder) ? [] : [settings.textEncoder]),
      ...(models.vaes.includes(settings.videoVae) ? [] : [settings.videoVae]),
      ...(models.vaes.includes(settings.audioVae) ? [] : [settings.audioVae]),
      ...(models.hasRemakeNode ? [] : ["RemakeConditioning node"]),
      ...(models.hasVhsNode ? [] : ["VHS_LoadVideo node"]),
    ];

    const editMissing = [
      ...(models.unets.includes(settings.editBase) ? [] : [settings.editBase]),
      ...settings.editLoras.filter((lora) => !models.loras.includes(lora.name)).map((lora) => lora.name),
      ...(models.clips.includes(settings.textEncoder) ? [] : [settings.textEncoder]),
      ...(models.vaes.includes(settings.videoVae) ? [] : [settings.videoVae]),
      ...(models.vaes.includes(settings.audioVae) ? [] : [settings.audioVae]),
      ...(models.hasRemakeNode ? [] : ["RemakeConditioning node"]),
      ...(models.hasVhsNode ? [] : ["VHS_LoadVideo node"]),
    ];

    const maskMissing = [
      ...(models.checkpoints.includes(SAM_CHECKPOINT) ? [] : [SAM_CHECKPOINT]),
      ...(models.hasSam3Node ? [] : ["SAM3_VideoTrack node"]),
      ...(models.hasPeopleMaskNode ? [] : ["H3PeopleMask node"]),
      ...(models.hasGrowMaskNode ? [] : ["GrowMaskWithBlur node"]),
      ...(models.hasVhsNode ? [] : ["VHS_LoadVideo node"]),
    ];

    const cutoutMissing = models.hasCutoutNode ? [] : ["easy imageRemBg (ComfyUI-Easy-Use)"];
    const captionMissing = [
      ...(models.hasCaptionNode ? [] : ["Florence2Run (ComfyUI-Florence2)"]),
      ...(models.captionModels.includes(CAPTION_MODEL) ? [] : [CAPTION_MODEL]),
    ];

    const capability = (missing: string[]) => ({ ready: missing.length === 0, missing });

    return NextResponse.json({
      comfyui: true,
      version: stats.system?.comfyui_version ?? null,
      device: stats.devices?.[0]?.name ?? null,
      queue: queueCounts(queue),
      capabilities: {
        swap: capability(swapMissing),
        edit: capability(editMissing),
        mask: capability(maskMissing),
        cutout: capability(cutoutMissing),
        caption: capability(captionMissing),
      },
    });
  } catch (error) {
    return NextResponse.json({
      comfyui: false,
      error: error instanceof Error ? error.message : "ComfyUI is not reachable.",
    });
  }
}
