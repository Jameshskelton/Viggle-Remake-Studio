"use client";

import { elapsedLabel } from "../lib/client-api.ts";
import type { JobProgress as Progress, JobStatus } from "../lib/types.ts";

export function JobProgress({ status, progress }: { status: JobStatus; progress?: Progress }) {
  if (status !== "running") return null;

  if (!progress || progress.max <= 0) {
    return (
      <div className="progress indeterminate" role="progressbar" aria-label="Working">
        <div className="progress-fill" />
      </div>
    );
  }

  const percent = Math.max(0, Math.min(100, Math.round((progress.value / progress.max) * 100)));
  const eta = progress.firstAt && progress.value > 0
    ? Math.max(0, Math.round(((Date.now() - progress.firstAt) / progress.value) * (progress.max - progress.value)))
    : undefined;

  return (
    <div className="stack" style={{ gap: 5 }}>
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={progress.value}
        aria-valuemin={0}
        aria-valuemax={progress.max}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="row between">
        <span className="note">Step {progress.value} of {progress.max}</span>
        {eta !== undefined && eta > 0 ? <span className="note">~{elapsedLabel(eta)} left</span> : null}
      </div>
    </div>
  );
}
