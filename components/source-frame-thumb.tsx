"use client";

import { useEffect, useRef } from "react";

export function SourceFrameThumb({ videoUrl, time }: { videoUrl: string; time: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const target = canvas.current;
      if (!target || !element.videoWidth) return;
      const width = 192;
      const height = Math.max(1, Math.round((element.videoHeight * width) / element.videoWidth));
      target.width = width;
      target.height = height;
      const context = target.getContext("2d");
      if (!context) return;
      context.drawImage(element, 0, 0, width, height);
    };

    const seek = () => {
      if (!element.duration) return;
      const wanted = Math.min(Math.max(0, time), Math.max(0, element.duration - 0.05));
      if (Math.abs(element.currentTime - wanted) < 0.02 && element.readyState >= 2) draw();
      else element.currentTime = wanted;
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
  }, [videoUrl, time]);

  return (
    <div className="pin-thumb-wrap">
      <video ref={video} src={videoUrl} muted playsInline preload="auto" style={{ display: "none" }} />
      <canvas ref={canvas} className="pin-thumb" />
    </div>
  );
}
