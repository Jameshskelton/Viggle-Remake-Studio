import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { assetFile, getAsset } from "../../../lib/assets.ts";
import { saveJob } from "../../../lib/jobs.ts";
import { copyIntoComfy } from "../../../lib/ffmpeg.ts";
import { buildCaptionGraph } from "../../../lib/caption-workflow.ts";
import { queuePrompt } from "../../../lib/comfy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { assetId?: string };
    const asset = body.assetId ? await getAsset(body.assetId) : null;
    if (!asset || asset.kind !== "image") {
      return NextResponse.json({ error: "Upload a reference image first." }, { status: 400 });
    }

    const key = randomUUID().slice(0, 8);
    const ext = path.extname(assetFile(asset)).replace(/^\./, "") || "png";
    const imageInput = await copyIntoComfy(assetFile(asset), `viggle-studio/${key}`, `reference.${ext}`);
    const graph = buildCaptionGraph({ imageInput });
    const id = await queuePrompt(graph);
    await saveJob({
      id,
      kind: "caption",
      createdAt: Date.now(),
      status: "queued",
      error: null,
      assetId: asset.id,
      start: 0,
      frames: 0,
      nodeKeys: { caption: "4" },
    });
    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to describe that image." },
      { status: 502 },
    );
  }
}
