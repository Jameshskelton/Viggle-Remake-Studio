"use client";

import { useCallback, useEffect, useState } from "react";
import { clearClipCache, deleteRenders, getRenderJobs, purgeAppData, type DeleteRendersResult, type PurgeResult } from "../lib/client-api.ts";
import { formatBytes } from "../lib/format.ts";
import { clearLocalData, draftAssetIds } from "../lib/persistence.ts";
import type { JobSummary } from "../lib/types.ts";
import { AppFooter, AppHeader } from "./app-header.tsx";

type DirStats = { bytes: number; files: number };
type Stats = {
  assets: DirStats;
  clips: DirStats;
  jobs: DirStats;
  comfy: { input: DirStats; output: DirStats } | null;
};
type CleanResult = { removedAssets: number; removedClips: number; removedComfy: number; freedBytes: number };

export function Storage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clipDays, setClipDays] = useState(7);
  const [cleanComfy, setCleanComfy] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [result, setResult] = useState<CleanResult | null>(null);
  const [renders, setRenders] = useState<JobSummary[] | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<DeleteRendersResult | null>(null);
  const [clearingClips, setClearingClips] = useState(false);
  const [clipResult, setClipResult] = useState<{ removedClips: number; freedBytes: number } | null>(null);
  const [purging, setPurging] = useState(false);
  const [purgeComfy, setPurgeComfy] = useState(true);
  const [resetSettings, setResetSettings] = useState(false);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/storage", { cache: "no-store" });
      const data = await response.json() as Stats & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to read storage usage.");
      setStats(data);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read storage usage.");
    }
  }, []);

  const loadRenders = useCallback(async () => {
    try {
      setRenders(await getRenderJobs(200));
      setRenderError(null);
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : "Unable to read the stored renders.");
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRenders();
  }, [load, loadRenders]);

  const removable = (job: JobSummary) => job.status === "succeeded" || job.status === "failed" || job.status === "cancelled";

  const removeRenders = async (input: { ids?: string[]; mode?: "swap" | "edit" }, label: string) => {
    if (!window.confirm(
      `Delete ${label}? The job records and archived videos are removed. Source clips, reference images and open drafts are kept.`,
    )) return;
    setDeleting(true);
    setRenderError(null);
    setDeleteResult(null);
    try {
      const deleted = await deleteRenders({ ...input, keepAssetIds: draftAssetIds() });
      setDeleteResult(deleted);
      await Promise.all([load(), loadRenders()]);
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : "Unable to delete the renders.");
    } finally {
      setDeleting(false);
    }
  };

  const clearClips = async () => {
    if (!window.confirm("Delete every cached source clip? They are rebuilt automatically when a render or mask needs them again.")) return;
    setClearingClips(true);
    setError(null);
    setClipResult(null);
    try {
      setClipResult(await clearClipCache());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to clear the clip cache.");
    } finally {
      setClearingClips(false);
    }
  };

  const purgeAll = async () => {
    const answer = window.prompt(
      "This deletes every uploaded asset, painted frame, archived render, cached clip and job record. Type DELETE to continue.",
    );
    if (answer !== "DELETE") return;
    setPurging(true);
    setPurgeError(null);
    setPurgeResult(null);
    try {
      const deleted = await purgeAppData({ confirm: "DELETE", cleanComfy: purgeComfy, resetSettings });
      setPurgeResult(deleted);
      clearLocalData();
      setDeleteResult(null);
      setClipResult(null);
      setResult(null);
      await Promise.all([load(), loadRenders()]);
    } catch (reason) {
      setPurgeError(reason instanceof Error ? reason.message : "Unable to delete the app data.");
    } finally {
      setPurging(false);
    }
  };

  const clean = async () => {
    if (!window.confirm(
      "Remove unused assets and cached clips? Assets referenced by a job or an open draft, and files newer than 24 hours, are kept.",
    )) return;
    setCleaning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/storage/clean", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAssetIds: draftAssetIds(), clipMaxAgeDays: clipDays, cleanComfy }),
      });
      const data = await response.json() as CleanResult & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to clean storage.");
      setResult(data);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to clean storage.");
    } finally {
      setCleaning(false);
    }
  };

  const appBytes = stats ? stats.assets.bytes + stats.clips.bytes + stats.jobs.bytes : 0;
  const comfyBytes = stats?.comfy ? stats.comfy.input.bytes + stats.comfy.output.bytes : 0;

  return (
    <main className="shell">
      <AppHeader tab="storage" />

      <div className="storage-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>App storage</h2>
              <p className="hint">Uploads, archived renders, painted frames, the clip cache and job records.</p>
            </div>
          </div>
          {!stats ? <p className="note">Loading…</p> : (
            <div>
              <div className="storage-row"><span>Assets</span><span>{formatBytes(stats.assets.bytes)} · {stats.assets.files} files</span></div>
              <div className="storage-row"><span>Clip cache</span><span>{formatBytes(stats.clips.bytes)} · {stats.clips.files} files</span></div>
              <div className="storage-row"><span>Job records</span><span>{formatBytes(stats.jobs.bytes)} · {stats.jobs.files} files</span></div>
              <div className="storage-total">{formatBytes(appBytes)} <small>in total</small></div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>ComfyUI storage</h2>
              <p className="hint">Files this app puts under ComfyUI&apos;s <span className="mono">viggle-studio</span> folders.</p>
            </div>
          </div>
          {!stats ? <p className="note">Loading…</p> : stats.comfy ? (
            <div>
              <div className="storage-row"><span>Input clips and references</span><span>{formatBytes(stats.comfy.input.bytes)} · {stats.comfy.input.files} files</span></div>
              <div className="storage-row"><span>Rendered output</span><span>{formatBytes(stats.comfy.output.bytes)} · {stats.comfy.output.files} files</span></div>
              <div className="storage-total">{formatBytes(comfyBytes)} <small>in total</small></div>
            </div>
          ) : (
            <p className="note">
              <span className="mono">COMFYUI_INPUT_DIR</span> is not set, so ComfyUI&apos;s folders cannot be measured or
              cleaned from here.
            </p>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Stored renders</h2>
            <p className="hint">
              Archived swap and edit videos and their job records. Active jobs cannot be deleted; source clips, reference
              images and open drafts are kept.
            </p>
          </div>
        </div>

        {renders ? (
          <div className="row">
            <button
              className="btn small danger"
              onClick={() => void removeRenders({ mode: "swap" }, "all completed swap renders")}
              disabled={deleting || !renders.some((job) => removable(job) && (job.mode ?? "swap") === "swap")}
            >
              Delete all swaps
            </button>
            <button
              className="btn small danger"
              onClick={() => void removeRenders({ mode: "edit" }, "all completed edit renders")}
              disabled={deleting || !renders.some((job) => removable(job) && job.mode === "edit")}
            >
              Delete all edits
            </button>
          </div>
        ) : null}

        {renderError ? <p className="note err" style={{ marginTop: 10 }}>{renderError}</p> : null}
        {deleteResult ? (
          <p className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
            Deleted {deleteResult.deleted} render{deleteResult.deleted === 1 ? "" : "s"}, removed{" "}
            {deleteResult.removedAssets} archived video{deleteResult.removedAssets === 1 ? "" : "s"} and{" "}
            {deleteResult.removedClips} cached clip{deleteResult.removedClips === 1 ? "" : "s"}, and freed{" "}
            {formatBytes(deleteResult.freedBytes)}. Active jobs were kept.
          </p>
        ) : null}

        {renders === null ? (
          <p className="note" style={{ marginTop: 12 }}>Loading renders…</p>
        ) : renders.length === 0 ? (
          <p className="note" style={{ marginTop: 12 }}>No renders stored.</p>
        ) : (
          <div className="storage-renders">
            {renders.map((job) => (
              <div className="storage-render" key={job.id}>
                <span className={`badge ${job.status === "succeeded" ? "on" : job.status === "failed" || job.status === "cancelled" ? "off" : ""}`}>
                  {job.status}
                </span>
                <div className="storage-render-main">
                  <strong>{job.mode === "edit" ? "Edit" : "Swap"} · {job.frames} frames</strong>
                  <span>{new Date(job.createdAt).toLocaleString()}</span>
                </div>
                <button
                  className="btn small danger"
                  onClick={() => void removeRenders({ ids: [job.id] }, "this render")}
                  disabled={deleting || !removable(job)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Clean up</h2>
            <p className="hint">
              Removes assets that no job or open draft references and are older than 24 hours, plus cached clips older than
              the selected age. Job records and the Renders history are not deleted.
            </p>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="clip-days">Remove cached clips older than</label>
            <div className="row">
              <input
                id="clip-days"
                className="input"
                type="number"
                min={1}
                max={365}
                value={clipDays}
                onChange={(event) => setClipDays(Math.min(365, Math.max(1, Math.round(Number(event.target.value) || 7))))}
                style={{ maxWidth: 120 }}
              />
              <span className="note">days</span>
            </div>
            <span className="note">Clips are rebuilt automatically when needed.</span>
          </div>
          <div className="field">
            <label>ComfyUI folders</label>
            <label className="toggle-row">
              <input type="checkbox" checked={cleanComfy} onChange={(event) => setCleanComfy(event.target.checked)} />
              <span>Also remove orphaned ComfyUI input/output folders</span>
            </label>
            <span className="note">Only folders no job references, older than 24 hours.</span>
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={clean} disabled={cleaning || !stats}>
            {cleaning ? "Cleaning…" : "Clean unused files"}
          </button>
          <button className="btn ghost" onClick={clearClips} disabled={clearingClips || !stats}>
            {clearingClips ? "Clearing…" : "Clear all cached clips"}
          </button>
          {error ? <span className="note err">{error}</span> : null}
        </div>

        {result ? (
          <p className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
            Freed {formatBytes(result.freedBytes)}: {result.removedAssets} asset{result.removedAssets === 1 ? "" : "s"},{" "}
            {result.removedClips} cached clip{result.removedClips === 1 ? "" : "s"}, {result.removedComfy} ComfyUI folder
            {result.removedComfy === 1 ? "" : "s"}.
          </p>
        ) : null}
        {clipResult ? (
          <p className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
            Removed {clipResult.removedClips} cached clip{clipResult.removedClips === 1 ? "" : "s"} and freed{" "}
            {formatBytes(clipResult.freedBytes)}.
          </p>
        ) : null}
      </section>

      <section className="card" style={{ borderColor: "rgba(255, 107, 107, 0.35)" }}>
        <div className="card-head">
          <div>
            <h2>Delete everything</h2>
            <p className="hint">
              Removes all uploaded assets, painted frames, archived renders, cached clips and job records. This cannot be
              undone. Model settings are kept unless you reset them.
            </p>
          </div>
        </div>
        <div className="stack">
          <label className="toggle-row">
            <input type="checkbox" checked={purgeComfy} onChange={(event) => setPurgeComfy(event.target.checked)} />
            <span>Also clear ComfyUI&apos;s viggle-studio input/output folders</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={resetSettings} onChange={(event) => setResetSettings(event.target.checked)} />
            <span>Also reset model settings to the environment defaults</span>
          </label>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn danger" onClick={() => void purgeAll()} disabled={purging}>
            {purging ? "Deleting…" : "Delete all app data"}
          </button>
          {purgeError ? <span className="note err">{purgeError}</span> : null}
        </div>
        {purgeResult ? (
          <p className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>
            Deleted {purgeResult.removedAssets} asset file{purgeResult.removedAssets === 1 ? "" : "s"},{" "}
            {purgeResult.removedJobs} job record{purgeResult.removedJobs === 1 ? "" : "s"},{" "}
            {purgeResult.removedClips} cached clip{purgeResult.removedClips === 1 ? "" : "s"} and{" "}
            {purgeResult.removedComfy} ComfyUI entr{purgeResult.removedComfy === 1 ? "y" : "ies"}. Freed{" "}
            {formatBytes(purgeResult.freedBytes)}.{purgeResult.removedSettings ? " Model settings were reset." : ""}
          </p>
        ) : null}
      </section>

      <AppFooter />
    </main>
  );
}
