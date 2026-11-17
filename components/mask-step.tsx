"use client";

import { elapsedLabel } from "../lib/client-api.ts";
import type { JobView } from "../lib/types.ts";
import { JobProgress } from "./job-progress.tsx";

export function MaskStep({ job, error, onCancel }: { job: JobView | null; error: string | null; onCancel: () => void }) {
  if (!job && !error) return null;
  return (
    <div className="stack">
      <div className={`status ${job?.status ?? "queued"}`} role="status" aria-live="polite">
        <span className="dot" />
        <span>
          {error
            ? error
            : job?.status === "queued"
              ? `Waiting for the GPU${job.queuePosition ? ` (queue ${job.queuePosition}${job.queue?.pending ? ` of ${job.queue.pending}` : ""})` : ""}...`
              : job?.status === "running"
                ? <>Tracking the character... <span aria-hidden="true">{job ? elapsedLabel(job.elapsed) : ""}</span></>
                : job?.status === "succeeded"
                  ? `Mask ready: ${job.frameCount ?? 0} frames and ${job.maskCount ?? 0} masks.`
                  : job?.status === "cancelled"
                    ? "Cancelled."
                    : job?.error ?? "The mask job failed."}
        </span>
      </div>
      {job ? <JobProgress status={job.status} progress={job.progress} /> : null}
      {job && (job.status === "queued" || job.status === "running") ? (
        <div className="row">
          <button className="btn small danger" onClick={onCancel}>Cancel mask</button>
        </div>
      ) : null}
      {job?.previewUrl ? (
        <div>
          <video className="media" src={job.previewUrl} controls loop playsInline />
          <p className="note" style={{ marginTop: 8 }}>
            Cyan is the area that will be replaced. Only this tracked person changes; the camera, cuts and soundtrack stay.
          </p>
        </div>
      ) : null}
    </div>
  );
}
