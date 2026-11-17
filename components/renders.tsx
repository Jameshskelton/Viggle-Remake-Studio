"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelJob, deleteRenders } from "../lib/client-api.ts";
import { formatBytes } from "../lib/format.ts";
import { draftAssetIds, writePendingSource, writeRecipe } from "../lib/persistence.ts";
import type { JobSummary } from "../lib/types.ts";
import { AppFooter, AppHeader } from "./app-header.tsx";
import { JobProgress } from "./job-progress.tsx";

type JobViewLite = {
  id: string;
  status: JobSummary["status"];
  error: string | null;
  outputUrl?: string;
  resultAssetId?: string;
  finishedAt?: number;
};

export function Renders() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const response = await fetch(`/api/jobs?limit=${limit}`, { cache: "no-store" });
        const data = await response.json() as { jobs?: JobSummary[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Unable to read the render history.");
        let list = data.jobs ?? [];

        // Jobs stopped being polled when their workspace closed. Refresh any that are
        // still marked active so this list does not stay stale.
        const pending = list.filter((job) => job.status === "queued" || job.status === "running").slice(0, 8);
        if (pending.length) {
          const views = await Promise.all(pending.map(async (job) => {
            try {
              const r = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
              if (!r.ok) return null;
              return await r.json() as JobViewLite;
            } catch {
              return null;
            }
          }));
          const byId = new Map(views.filter((view): view is JobViewLite => Boolean(view)).map((view) => [view.id, view]));
          list = list.map((job) => {
            const view = byId.get(job.id);
            return view
              ? { ...job, status: view.status, error: view.error, outputUrl: view.outputUrl, resultAssetId: view.resultAssetId, finishedAt: view.finishedAt }
              : job;
          });
        }

        if (!active) return;
        setJobs(list);
        setError(null);
        setSelectedId((current) => (current && list.some((job) => job.id === current) ? current : list[0]?.id ?? null));
        if (list.some((job) => job.status === "queued" || job.status === "running")) {
          timer = setTimeout(load, 4000);
        }
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Unable to read the render history.");
        timer = setTimeout(load, 5000);
      }
    };

    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [limit, version]);

  const selected = useMemo(() => jobs?.find((job) => job.id === selectedId) ?? null, [jobs, selectedId]);

  const cancel = async (job: JobSummary) => {
    setCancelling(job.id);
    setCancelError(null);
    try {
      await cancelJob(job.id);
      setJobs((current) => current?.map((item) => (
        item.id === job.id
          ? { ...item, status: "cancelled", error: "Cancelled by the user.", finishedAt: Date.now() }
          : item
      )) ?? current);
    } catch (reason) {
      setCancelError(reason instanceof Error ? reason.message : "Unable to cancel the render.");
    } finally {
      setCancelling(null);
    }
  };

  const deleteAll = async () => {
    if (!window.confirm(
      "Delete all completed renders and their archived videos? Active jobs, source clips, reference images and open drafts are kept. This cannot be undone.",
    )) return;
    setDeletingAll(true);
    setDeleteError(null);
    setDeleteNote(null);
    try {
      const result = await deleteRenders({ all: true, keepAssetIds: draftAssetIds() });
      setDeleteNote(
        `Deleted ${result.deleted} stored render${result.deleted === 1 ? "" : "s"}, removed ${result.removedClips} cached clip${result.removedClips === 1 ? "" : "s"} and freed ${formatBytes(result.freedBytes)}.`,
      );
      setSelectedId(null);
      setVersion((value) => value + 1);
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : "Unable to delete the stored renders.");
    } finally {
      setDeletingAll(false);
    }
  };

  const useAsSource = (job: JobSummary) => {
    if (!job.resultAssetId) return;
    writePendingSource(job.resultAssetId);
    router.push(`${job.mode === "edit" ? "/edit" : "/"}?step=1`);
  };

  const reuseSettings = (job: JobSummary) => {
    if (!job.prompt) return;
    writeRecipe({
      mode: job.mode === "edit" ? "edit" : "swap",
      referenceMode: job.referenceMode,
      videoId: job.assetId,
      start: job.start,
      frames: job.frames,
      seed: job.seed ?? 0,
      shortEdge: job.shortEdge ?? 480,
      prompt: job.prompt,
      keyframeUntil: job.keyframeUntil ?? 0.9,
      pinKeyframes: job.pinKeyframes ?? false,
      refs: job.refs ?? [],
    });
    router.push(`${job.mode === "edit" ? "/edit" : "/"}?step=4`);
  };

  return (
    <main className="shell">
      <AppHeader tab="renders" />

      <div className="renders-grid">
        <section className="card">
          <div className="card-head" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <h2>Recent renders</h2>
              <p className="hint">Newest first. Active renders refresh automatically.</p>
            </div>
            {jobs && jobs.length > 0 ? (
              <button
                className="btn small danger"
                style={{ marginLeft: "auto" }}
                onClick={() => void deleteAll()}
                disabled={deletingAll}
              >
                {deletingAll ? "Deleting…" : "Delete all stored renders"}
              </button>
            ) : null}
          </div>

          {error ? <p className="note err">{error}</p> : null}
          {jobs === null ? <p className="note">Loading…</p> : null}
          {jobs && jobs.length === 0 ? (
            <p className="note">No renders yet. Start one from Swap character or Edit video.</p>
          ) : null}

          {jobs && jobs.length > 0 ? (
            <ul className="render-list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    className={`render-row${job.id === selectedId ? " selected" : ""}`}
                    onClick={() => setSelectedId(job.id)}
                  >
                    <span className={`badge ${job.status === "succeeded" ? "on" : job.status === "failed" || job.status === "cancelled" ? "off" : ""}`}>
                      {job.status}
                    </span>
                    <span className="render-main">
                      <strong>{job.mode === "edit" ? "Edit" : "Swap"} · {job.frames} frames</strong>
                      <span className="render-meta">
                        <span>{new Date(job.createdAt).toLocaleString()}</span>
                        <span>{(job.frames / 24).toFixed(2)} s</span>
                        <span>seed {job.seed ?? 0}</span>
                        <span>{job.shortEdge === 736 ? "1280×736" : "832×480"}</span>
                      </span>
                    </span>
                    <span className="render-arrow" aria-hidden="true">›</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {deleteNote ? <p className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>{deleteNote}</p> : null}
          {deleteError ? <p className="note err" style={{ marginTop: 10 }}>{deleteError}</p> : null}
          {jobs && jobs.length > 0 && jobs.length >= limit && limit < 200 ? (
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn small ghost" onClick={() => setLimit((value) => Math.min(200, value + 60))}>
                Show older renders
              </button>
            </div>
          ) : null}
        </section>

        <section className="card">
          {!selected ? (
            <p className="note">Pick a render to play, download or reuse.</p>
          ) : (
            <div className="stack">
              <div className="card-head">
                <div>
                  <h2>{selected.mode === "edit" ? "Edit" : "Swap"} render</h2>
                  <p className="hint">
                    {new Date(selected.createdAt).toLocaleString()} · {selected.frames} frames · seed {selected.seed ?? 0}
                  </p>
                </div>
              </div>

              {selected.status === "failed" || selected.status === "cancelled" ? (
                <p className={selected.status === "failed" ? "note err" : "note warn"}>
                  {selected.error ?? (selected.status === "cancelled" ? "Cancelled." : "The render failed.")}
                </p>
              ) : null}

              <JobProgress status={selected.status} progress={selected.progress} />

              {selected.outputUrl ? (
                <video className="media" src={selected.outputUrl} controls loop playsInline />
              ) : (
                <p className="note">
                  {selected.status === "succeeded"
                    ? "This render finished before local archiving was added, so only ComfyUI has the file."
                    : "The video appears when the render finishes."}
                </p>
              )}

              <div className="row">
                {selected.status === "queued" || selected.status === "running" ? (
                  <button className="btn small danger" onClick={() => void cancel(selected)} disabled={cancelling === selected.id}>
                    {cancelling === selected.id ? "Cancelling…" : "Cancel render"}
                  </button>
                ) : null}
                {selected.outputUrl ? (
                  <a className="btn small" href={`${selected.outputUrl}?download=1`}>Download MP4</a>
                ) : null}
                {selected.resultAssetId ? (
                  <button className="btn small ghost" onClick={() => useAsSource(selected)}>Use as source</button>
                ) : null}
                {selected.prompt ? (
                  <button className="btn small ghost" onClick={() => reuseSettings(selected)}>Reuse settings</button>
                ) : null}
              </div>

              {cancelError ? <p className="note err">{cancelError}</p> : null}

              {selected.prompt ? (
                <div className="field">
                  <label>Prompt</label>
                  <pre className="render-prompt">{selected.prompt}</pre>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <AppFooter />
    </main>
  );
}
