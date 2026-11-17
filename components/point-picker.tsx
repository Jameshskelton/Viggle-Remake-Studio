"use client";

import { useEffect, useRef, useState } from "react";
import type { ManualPoint } from "../lib/types.ts";

export function PointPicker({
  videoUrl,
  start,
  point,
  onPick,
}: {
  videoUrl: string;
  start: number;
  point: ManualPoint | null;
  onPick: (point: ManualPoint) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const target = canvas.current;
      if (!target || !element.videoWidth) return;
      const width = Math.min(1008, element.videoWidth);
      const height = Math.round((element.videoHeight * width) / element.videoWidth);
      target.width = width;
      target.height = height;
      const context = target.getContext("2d");
      if (!context) return;
      context.drawImage(element, 0, 0, width, height);
      setReady(true);
    };

    const seek = () => {
      if (!element.duration) return;
      const time = Math.min(Math.max(0, start), Math.max(0, element.duration - 0.05));
      if (Math.abs(element.currentTime - time) < 0.02 && element.readyState >= 2) draw();
      else element.currentTime = time;
    };

    element.addEventListener("loadedmetadata", seek);
    element.addEventListener("seeked", draw);
    element.addEventListener("loadeddata", draw);
    if (element.readyState >= 1) seek();

    return () => {
      cancelled = true;
      element.removeEventListener("loadedmetadata", seek);
      element.removeEventListener("seeked", draw);
      element.removeEventListener("loadeddata", draw);
    };
  }, [videoUrl, start]);

  return (
    <div className="stack">
      <video ref={video} src={videoUrl} muted playsInline preload="auto" style={{ display: "none" }} />
      <div className="frame-picker">
        <canvas
          ref={canvas}
          onClick={(event) => {
            if (!ready) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onPick({
              x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
              y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
            });
          }}
        />
        {point ? <span className="pin-dot" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} /> : null}
      </div>
      <p className="note">
        {point
          ? "Character picked. Click again to move the point; SAM tracks that person through the clip."
          : "Click the character's body on this first frame. A point on the torso usually tracks best."}
      </p>
    </div>
  );
}
