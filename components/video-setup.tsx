"use client";

import { useEffect } from "react";
import { DropZone } from "./dropzone.tsx";
import { bestFitFrames, frameOptions, sourceFramesFor } from "../lib/frames.ts";
import type { Asset } from "../lib/types.ts";

export function VideoSetup({
  asset,
  onAsset,
  onClear,
  start,
  onStart,
  frames,
  onFrames,
}: {
  asset: Asset | null;
  onAsset: (asset: Asset) => void;
  onClear: () => void;
  start: number;
  onStart: (start: number) => void;
  frames: number;
  onFrames: (frames: number) => void;
}) {
  const options = frameOptions();
  const sourceFrames = asset?.frames ?? sourceFramesFor(asset?.duration ?? 0);
  const maxStartFrame = Math.max(0, sourceFrames - frames);
  const startFrame = Math.min(Math.round(start * 24), maxStartFrame);
  const loops = sourceFrames < frames;

  useEffect(() => {
    if (Math.round(start * 24) > maxStartFrame) onStart(maxStartFrame / 24);
  }, [maxStartFrame, start, onStart]);

  return (
    <div className="stack">
      {!asset ? (
        <DropZone
          kind="video"
          label="Drop a source video"
          hint="MP4, MOV, WebM, MKV or AVI. Short clips are looped automatically to fill the selected frame count."
          accept="video/*,.mkv,.avi"
          onUpload={onAsset}
        />
      ) : (
        <div className="video-wrap">
          <video className="media" src={`/api/assets/${asset.id}/file`} controls playsInline />
          <button
            type="button"
            className="media-remove"
            onClick={onClear}
            title="Remove video"
            aria-label="Remove video"
          >
            ×
          </button>
          <div className="meta">
            <span>{asset.name}</span>
            <span>{asset.width}×{asset.height}</span>
            <span>{asset.fps ? `${asset.fps.toFixed(2)} fps` : "video"}</span>
            <span>{asset.duration ? `${asset.duration.toFixed(2)} s` : ""}</span>
            <span>{sourceFrames} frames @ 24 fps</span>
            <span>{asset.hasAudio ? "with audio" : "silent"}</span>
            <button className="btn ghost" onClick={onClear}>Replace video</button>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="field">
          <label htmlFor="length">Frames to render</label>
          <div className="row">
            <select id="length" className="select grow" value={frames} onChange={(event) => onFrames(Number(event.target.value))}>
              {options.map((option) => (
                <option key={option.frames} value={option.frames}>
                  {option.frames} frames — {option.seconds.toFixed(2)} s
                </option>
              ))}
            </select>
            <button
              className="btn small ghost"
              disabled={!asset}
              onClick={() => onFrames(bestFitFrames(sourceFrames))}
              title="Pick the longest valid window that fits the whole source"
            >
              Fit to video
            </button>
          </div>
          <span className="note">
            Viggle Remake renders one window of 17n+5 frames at 24 fps (3.75–14.4 s). The source is trimmed to exactly this many
            frames{loops ? ", and looped because it is shorter than the window" : ""}.
          </span>
        </div>
        <div className="field">
          <label htmlFor="start">Start frame</label>
          <input
            id="start"
            className="input"
            type="range"
            min={0}
            max={maxStartFrame}
            step={1}
            value={startFrame}
            onChange={(event) => onStart(Number(event.target.value) / 24)}
            disabled={!asset}
          />
          <span className="note">
            Frame {startFrame} · {(startFrame / 24).toFixed(2)} s
            {asset ? ` of ${asset.duration?.toFixed(2) ?? "?"} s` : ""}
          </span>
          <span className="note">
            {loops
              ? `The source has only ${sourceFrames} frames; it loops to fill ${frames}.`
              : `Trims source frames ${startFrame}–${startFrame + frames - 1} into a ${frames}-frame render.`}
          </span>
        </div>
      </div>
    </div>
  );
}
