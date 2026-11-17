"use client";

import Link from "next/link";
import { elapsedLabel } from "../lib/client-api.ts";
import { DEFAULT_SAMPLING_STEPS } from "../lib/model-settings.ts";
import { holdPresets, type HoldPresetId } from "../lib/keyframe-hold.ts";
import type { JobView } from "../lib/types.ts";
import { JobProgress } from "./job-progress.tsx";
import { PromptPanel } from "./prompt-panel.tsx";

export function RenderStep({
  samplingSteps = DEFAULT_SAMPLING_STEPS,
  prompt,
  promptOverride,
  onPromptOverride,
  onPromptChange,
  onRebuild,
  shortEdge,
  onShortEdge,
  seed,
  onSeed,
  frames,
  refCount,
  refsReady,
  ready,
  direct,
  kind = "swap",
  holdPreset,
  onHoldPreset,
  pinKeyframes,
  onPinKeyframes,
  pinsAllowed = true,
  busy,
  error,
  job,
  onRender,
  onCancel,
}: {
  samplingSteps?: number;
  prompt: string;
  promptOverride: boolean;
  onPromptOverride: (value: boolean) => void;
  onPromptChange: (value: string) => void;
  onRebuild: () => void;
  shortEdge: number;
  onShortEdge: (value: number) => void;
  seed: number;
  onSeed: (value: number) => void;
  frames: number;
  refCount: number;
  refsReady: boolean;
  ready?: boolean;
  direct: boolean;
  kind?: "swap" | "edit";
  holdPreset: HoldPresetId;
  onHoldPreset: (value: HoldPresetId) => void;
  pinKeyframes: boolean;
  onPinKeyframes: (value: boolean) => void;
  pinsAllowed?: boolean;
  busy: boolean;
  error: string | null;
  job: JobView | null;
  onRender: () => void;
  onCancel: () => void;
}) {
  const presets = holdPresets(kind === "edit" ? "edit" : "swap", samplingSteps);
  const activePreset = presets.find((preset) => preset.id === holdPreset) ?? presets[1];

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="field">
          <label htmlFor="shortEdge">Render size</label>
          <select id="shortEdge" className="select" value={shortEdge} onChange={(event) => onShortEdge(Number(event.target.value))}>
            <option value={480}>832×480 — fast (recommended)</option>
            <option value={736}>1280×736 — sharper, slower</option>
          </select>
          <span className="note">{frames} frames at 24 fps = {(frames / 24).toFixed(2)} s.</span>
        </div>
        <div className="field">
          <label htmlFor="seed">Seed</label>
          <div className="row">
            <input
              id="seed"
              className="input"
              type="number"
              min={0}
              value={seed}
              onChange={(event) => onSeed(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
            />
            <button className="btn small ghost" onClick={() => onSeed(Math.floor(Math.random() * 2 ** 31))}>Random</button>
          </div>
        </div>
      </div>

      {direct ? (
        <div className="field">
          <label>Character reference</label>
          <span className="note">
            Direct image: one character picture, no keyframes and no pins. The source clip drives the pose, camera and timing.
          </span>
        </div>
      ) : (
        <div className="grid-2">
          <div className="field">
            <label>{kind === "edit" ? "Reference pins (optional)" : "Keyframe pins"}</label>
            <div className="chips">
              <button
                className={`chip${pinKeyframes ? " active" : ""}`}
                onClick={() => onPinKeyframes(true)}
                disabled={!pinsAllowed}
              >
                {kind === "edit" ? "Pin references" : "Pin keyframes"}
              </button>
              <button className={`chip${!pinKeyframes ? " active" : ""}`} onClick={() => onPinKeyframes(false)}>References only</button>
            </div>
            <span className="note">
              {kind === "edit"
                ? "Optional. Pins place a reference at its chosen source frame. References only is the default and needs no keyframes; the images just show the target look."
                : "Pins hold the painted pose at their frames. References only lets the source motion dominate."}
              {!pinsAllowed && refCount > 0 ? " Pinning is unavailable until every reference is an edited source frame." : ""}
            </span>
          </div>
          <div className="field">
            <label>{kind === "edit" ? "Composition guidance" : "Composition guidance"}</label>
            <div className="chips">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className={`chip${holdPreset === preset.id ? " active" : ""}`}
                  onClick={() => onHoldPreset(preset.id)}
                  title={preset.hint}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <span className="note">
              {activePreset.hint} Stronger guidance holds the pinned frame for more of the render. Sampling runs{" "}
              {samplingSteps} step{samplingSteps === 1 ? "" : "s"}; change this in <Link href="/settings">Advanced</Link>.
            </span>
          </div>
        </div>
      )}

      <PromptPanel
        prompt={prompt}
        override={promptOverride}
        onOverrideChange={onPromptOverride}
        onPromptChange={onPromptChange}
        onRebuild={onRebuild}
      />

      <div className="row between">
        <span className="note">
          {direct
            ? (refsReady ? "1 character reference ready" : "Add a character image first")
            : kind === "edit"
              ? !(ready ?? true)
                ? "Describe the edit above first"
                : refCount > 0
                  ? `${refCount} reference image${refCount === 1 ? "" : "s"} ready`
                  : "Text-only edit — the source frame is used as a reference"
              : `${refCount} painted keyframe${refCount === 1 ? "" : "s"} ready${refsReady ? "" : " — save each keyframe first"}`}
        </span>
        <button className="btn primary" disabled={!(ready ?? refsReady) || busy} onClick={onRender}>
          {busy ? "Submitting..." : "Render with Viggle Remake"}
        </button>
      </div>

      {error ? <p className="note err">{error}</p> : null}
      {job ? (
        <div className="stack">
          <div className={`status ${job.status}`} role="status" aria-live="polite">
            <span className="dot" />
            <span>
              {job.status === "queued"
                ? `Queued${job.queuePosition ? ` at position ${job.queuePosition}${job.queue?.pending ? ` of ${job.queue.pending}` : ""}` : ""}...`
                : job.status === "running"
                  ? <>Rendering with Viggle Remake... <span aria-hidden="true">{elapsedLabel(job.elapsed)}</span></>
                  : job.status === "succeeded"
                    ? "Finished."
                    : job.status === "cancelled"
                      ? "Cancelled."
                      : job.error ?? "The render failed."}
            </span>
          </div>
          <JobProgress status={job.status} progress={job.progress} />
          {job.status === "queued" || job.status === "running" ? (
            <div className="row">
              <button className="btn small danger" onClick={onCancel}>Cancel render</button>
            </div>
          ) : null}
          {job.outputUrl ? (
            <div>
              <video className="media" src={job.outputUrl} controls loop playsInline />
              <div className="row" style={{ marginTop: 10 }}>
                <a className="btn small" href={`${job.outputUrl}?download=1`}>Download MP4</a>
                <span className="note">The original soundtrack is carried through; mouths follow the real speech.</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
