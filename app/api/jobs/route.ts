import { NextResponse } from "next/server";
import { listJobs, outputUrlFor } from "../../../lib/jobs.ts";
import { ensureProgressSocket, progressFor } from "../../../lib/comfy-progress.ts";
import type { JobSummary } from "../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureProgressSocket();
  const params = new URL(request.url).searchParams;
  const requested = Math.round(Number(params.get("limit") ?? 60));
  const limit = Math.min(200, Math.max(1, Number.isFinite(requested) ? requested : 60));
  const jobs = (await listJobs(10000))
    .filter((job) => job.kind === "render")
    .slice(0, limit);
  const summaries: JobSummary[] = jobs
    .map((job) => ({
      id: job.id,
      kind: job.kind,
      mode: job.mode,
      referenceMode: job.referenceMode,
      status: job.status,
      progress: progressFor(job.id, job.progressNode),
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      frames: job.frames,
      start: job.start,
      assetId: job.assetId,
      shortEdge: job.shortEdge,
      seed: job.seed,
      keyframeUntil: job.keyframeUntil,
      pinKeyframes: job.pinKeyframes,
      refs: job.refs,
      prompt: job.prompt,
      error: job.error ?? null,
      outputUrl: outputUrlFor(job),
      resultAssetId: job.resultAssetId,
    }));
  return NextResponse.json({ jobs: summaries });
}
