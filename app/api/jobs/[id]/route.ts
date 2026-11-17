import { NextResponse } from "next/server";
import { getJob, outputUrlFor, saveJob } from "../../../../lib/jobs.ts";
import { getHistory, getQueue, messageError, queueCounts } from "../../../../lib/comfy.ts";
import { clearProgress, ensureProgressSocket, progressFor } from "../../../../lib/comfy-progress.ts";
import { resolveJobStatus } from "../../../../lib/job-status.ts";
import { finalizeCompletedJob } from "../../../../lib/job-finalize.ts";
import type { JobRecord, JobStatus, JobView } from "../../../../lib/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL: JobStatus[] = ["succeeded", "failed", "cancelled"];

function view(
  job: JobRecord,
  status: JobStatus,
  error: string | null,
  queuePosition: number | null,
  queue?: JobView["queue"],
): JobView {
  return {
    id: job.id,
    kind: job.kind,
    mode: job.mode,
    status,
    finishedAt: job.finishedAt,
    queuePosition,
    queue,
    progress: progressFor(job.id, job.progressNode),
    error,
    elapsed: (job.finishedAt ?? Date.now()) - job.createdAt,
    frames: job.frames,
    previewUrl: job.preview ? `/api/jobs/${job.id}/preview` : undefined,
    outputUrl: outputUrlFor(job),
    resultAssetId: job.resultAssetId,
    resultText: job.resultText,
    frameCount: job.frameFiles?.length,
    maskCount: job.maskFiles?.length,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  ensureProgressSocket();

  // ComfyUI drops history when it restarts. Once a job is terminal, keep its saved result
  // instead of re-deriving "failed" from a history entry that no longer exists.
  const savedFrames = job.frameFiles?.length ?? 0;
  if (job.status === "failed" || job.status === "cancelled"
    || (job.status === "succeeded" && (Boolean(job.output) || Boolean(job.resultAssetId) || Boolean(job.resultText) || savedFrames > 0))) {
    return NextResponse.json(view(job, job.status, job.error ?? null, null));
  }

  let historyError = false;
  let queueError = false;
  const entry = await getHistory(id).catch(() => {
    historyError = true;
    return null;
  });
  const queue = await getQueue().catch(() => {
    queueError = true;
    return { queue_running: [], queue_pending: [] };
  });

  const running = (queue.queue_running ?? []).some((item) => item[1] === id);
  const pendingIndex = (queue.queue_pending ?? []).findIndex((item) => item[1] === id);

  const resolved = resolveJobStatus({
    storedStatus: job.status,
    createdAt: job.createdAt,
    entry,
    running,
    pendingIndex,
    historyError,
    queueError,
    now: Date.now(),
  });
  if (resolved.kind === "retry") {
    return NextResponse.json({ error: resolved.error }, { status: 503 });
  }
  let status: JobStatus = resolved.status;
  let error = resolved.error;
  let queuePosition: number | null = resolved.queuePosition;

  if (status === "succeeded" && !job.output && !job.frameFiles) {
    try {
      await finalizeCompletedJob(id, entry);
    } catch (reason) {
      const current = (await getJob(id)) ?? job;
      current.status = "failed";
      current.error = reason instanceof Error ? reason.message : "Could not finalize the job.";
      current.finishedAt = Date.now();
      await saveJob(current);
      return NextResponse.json(view(current, "failed", current.error, queuePosition, queueError ? undefined : queueCounts(queue)));
    }

    job = (await getJob(id)) ?? job;
    if (TERMINAL.includes(job.status)) {
      return NextResponse.json(view(job, job.status, job.error ?? null, queuePosition, queueError ? undefined : queueCounts(queue)));
    }
    status = "failed";
    error = "The job finished without a readable result.";
  }

  const isFinished = TERMINAL.includes(status);
  const finishedAt = isFinished ? (job.finishedAt ?? Date.now()) : undefined;
  const dirty = job.status !== status
    || job.error !== error
    || Boolean(job.output)
    || Boolean(job.frameFiles)
    || Boolean(job.resultAssetId)
    || Boolean(job.resultText)
    || job.finishedAt !== finishedAt;
  job.status = status;
  job.error = error;
  job.finishedAt = finishedAt;
  if (isFinished) clearProgress(id);
  if (dirty) await saveJob(job);

  return NextResponse.json(view(job, status, error, queuePosition, queueError ? undefined : queueCounts(queue)));
}
