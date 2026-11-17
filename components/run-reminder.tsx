"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { elapsedLabel, useJob } from "../lib/client-api.ts";
import { readRun, type StoredRun } from "../lib/persistence.ts";

type Mode = "swap" | "edit";

type ActiveRun = { mode: Mode; run: StoredRun };

const PAGES: Record<Mode, string> = { swap: "/", edit: "/edit" };
const RENDER_STEPS: Record<Mode, string> = { swap: "/?step=4", edit: "/edit?step=4" };
const LABELS: Record<Mode, string> = { swap: "Character swap", edit: "Edit video" };
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

function readActiveRuns(): ActiveRun[] {
  return (["swap", "edit"] as const)
    .map((mode) => ({ mode, run: readRun(mode) }))
    .filter((item): item is ActiveRun => Boolean(item.run));
}

function RunCard({ mode, run, onDismiss }: { mode: Mode; run: StoredRun; onDismiss: () => void }) {
  const { job } = useJob(run.jobId);
  if (!job || TERMINAL.has(job.status)) return null;

  const queued = job.status === "queued";
  const progress = job.progress && job.progress.max > 0
    ? Math.min(1, job.progress.value / job.progress.max)
    : null;
  const position = job.queuePosition;
  const percent = progress !== null && !queued ? Math.round(progress * 100) : null;

  return (
    <div className="run-reminder" role="status">
      <div className="run-reminder-head">
        <span className="run-reminder-dot" aria-hidden="true" />
        <strong>{LABELS[mode]} {queued ? "is queued" : "is running"}</strong>
        <button
          type="button"
          className="run-reminder-close"
          onClick={onDismiss}
          aria-label={`Dismiss ${LABELS[mode]} reminder`}
        >
          ×
        </button>
      </div>
      <p className="run-reminder-meta">
        {queued
          ? position ? `Queue position ${position}.` : "Waiting for a free GPU."
          : `${elapsedLabel(job.elapsed)} elapsed${percent !== null ? ` · ${percent}%` : ""}`}
      </p>
      <div className={`progress${percent !== null ? "" : " indeterminate"}`} aria-hidden="true">
        <div className="progress-fill" style={percent !== null ? { width: `${percent}%` } : undefined} />
      </div>
      <Link className="btn primary small run-reminder-go" href={RENDER_STEPS[mode]}>
        Back to {mode === "swap" ? "swap" : "edit"}
      </Link>
    </div>
  );
}

export function RunReminder() {
  const pathname = usePathname();
  const [runs, setRuns] = useState<ActiveRun[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const refresh = useCallback(() => setRuns(readActiveRuns()), []);

  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const timer = setInterval(refresh, 4000);
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("viggle:")) refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const visible = runs.filter(({ mode, run }) => pathname !== PAGES[mode] && !dismissed.includes(run.jobId));
  if (!visible.length) return null;

  return (
    <div className="run-reminder-stack" aria-live="polite">
      {visible.map(({ mode, run }) => (
        <RunCard
          key={`${mode}-${run.jobId}`}
          mode={mode}
          run={run}
          onDismiss={() => setDismissed((ids) => (ids.includes(run.jobId) ? ids : [...ids, run.jobId]))}
        />
      ))}
    </div>
  );
}
