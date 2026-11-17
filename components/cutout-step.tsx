"use client";

import { elapsedLabel } from "../lib/client-api.ts";
import type { JobView } from "../lib/types.ts";
import { JobProgress } from "./job-progress.tsx";

export function CutoutStep({
  job,
  error,
  starting,
  canUseOriginal,
  onRetry,
  onUseOriginal,
  onCancel,
}: {
  job: JobView | null;
  error: string | null;
  starting: boolean;
  canUseOriginal: boolean;
  onRetry: () => void;
  onUseOriginal: () => void;
  onCancel: () => void;
}) {
  if (!job && !error && !starting) return null;
  const status = starting ? "queued" : job?.status ?? (error ? "failed" : "queued");
  const failed = Boolean(error) || job?.status === "failed";
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={`status ${status}`} role="status" aria-live="polite">
        <span className="dot" />
        <span>
          {error
            ? error
            : starting
              ? "Starting background removal..."
              : job?.status === "queued"
                ? `Waiting for the GPU${job.queuePosition ? ` (queue ${job.queuePosition})` : ""}...`
                : job?.status === "running"
                  ? <>Removing the background... <span aria-hidden="true">{job ? elapsedLabel(job.elapsed) : ""}</span></>
                  : job?.status === "succeeded"
                    ? "Background removed. Transparent PNG ready."
                    : job?.status === "cancelled"
                      ? "Cancelled."
                      : job?.error ?? "Background removal failed."}
        </span>
      </div>
      {job ? <JobProgress status={job.status} progress={job.progress} /> : null}
      {job && (job.status === "queued" || job.status === "running") ? (
        <div className="row">
          <button className="btn small danger" onClick={onCancel}>Cancel</button>
        </div>
      ) : null}
      {failed || canUseOriginal ? (
        <div className="row">
          {failed ? <button className="btn small ghost" onClick={onRetry}>Try again</button> : null}
          {canUseOriginal ? <button className="btn small ghost" onClick={onUseOriginal}>Use original</button> : null}
        </div>
      ) : null}
    </div>
  );
}
