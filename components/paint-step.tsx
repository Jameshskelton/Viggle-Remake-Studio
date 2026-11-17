"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { uploadFile } from "../lib/client-api.ts";
import { candidateIndices } from "../lib/frames.ts";
import { dateStamp } from "../lib/datetime.ts";

export type RefTransform = { scale: number; x: number; y: number; assetId?: string };
type Box = { x: number; y: number; w: number; h: number };

const DEFAULT_TRANSFORM: RefTransform = { scale: 1, x: 0, y: 0 };

function contentBox(image: HTMLImageElement): Box {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, width, height);
  if (width * height === 0) return { x: 0, y: 0, w: width, h: height };
  const pixels = context.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (pixels[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function analyzeMask(mask: HTMLImageElement) {
  const width = mask.naturalWidth;
  const height = mask.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  context.drawImage(mask, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const value = pixels.data[(y * width + x) * 4];
      if (value > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    minX = 0; minY = 0; maxX = width - 1; maxY = height - 1;
  }

  for (let i = 0; i < pixels.data.length; i += 4) {
    const alpha = pixels.data[i];
    pixels.data[i] = 255;
    pixels.data[i + 1] = 255;
    pixels.data[i + 2] = 255;
    pixels.data[i + 3] = alpha;
  }
  context.putImageData(pixels, 0, 0);

  return {
    alpha: canvas,
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } as Box,
  };
}

function RefEditor({
  jobId,
  index,
  targetUrl,
  state,
  onChange,
  onSaved,
}: {
  jobId: string;
  index: number;
  targetUrl: string;
  state: RefTransform;
  onChange: (state: RefTransform) => void;
  onSaved: (assetId: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<{ frame: HTMLImageElement; mask: HTMLImageElement } | null>(null);
  const [target, setTarget] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const savedKey = useRef("");
  const latestKey = useRef("");

  useEffect(() => {
    let active = true;
    setImages(null);
    setLoadError("");
    const frame = new Image();
    const mask = new Image();
    frame.src = `/api/jobs/${jobId}/frames/${index}?type=frame`;
    mask.src = `/api/jobs/${jobId}/frames/${index}?type=mask`;
    let loaded = 0;
    const done = () => {
      loaded++;
      if (loaded === 2 && active) setImages({ frame, mask });
    };
    const fail = () => { if (active) setLoadError("Could not load this keyframe's mask."); };
    frame.onload = done;
    mask.onload = done;
    frame.onerror = fail;
    mask.onerror = fail;
    return () => { active = false; };
  }, [jobId, index]);

  useEffect(() => {
    let active = true;
    setTarget(null);
    const image = new Image();
    image.onload = () => { if (active) setTarget(image); };
    image.src = targetUrl;
    return () => { active = false; };
  }, [targetUrl]);

  const analysis = useMemo(() => (images ? analyzeMask(images.mask) : null), [images]);
  const sourceBox = useMemo(() => (target ? contentBox(target) : null), [target]);

  useEffect(() => {
    if (!images || !target || !analysis || !sourceBox) return;
    const element = canvas.current;
    if (!element) return;
    const width = images.frame.naturalWidth;
    const height = images.frame.naturalHeight;
    element.width = width;
    element.height = height;
    const context = element.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(images.frame, 0, 0, width, height);

    const { bbox } = analysis;
    const fit = Math.min((bbox.w * 1.04) / sourceBox.w, (bbox.h * 1.04) / sourceBox.h);
    const drawW = sourceBox.w * fit * state.scale;
    const drawH = sourceBox.h * fit * state.scale;
    const cx = bbox.x + bbox.w / 2 + state.x * bbox.w;
    const cy = bbox.y + bbox.h / 2 + state.y * bbox.h;

    const temp = document.createElement("canvas");
    temp.width = width;
    temp.height = height;
    const tempContext = temp.getContext("2d")!;
    tempContext.drawImage(
      target,
      sourceBox.x, sourceBox.y, sourceBox.w, sourceBox.h,
      cx - drawW / 2, cy - drawH / 2, drawW, drawH,
    );
    tempContext.globalCompositeOperation = "destination-in";
    tempContext.drawImage(analysis.alpha, 0, 0, width, height);
    context.drawImage(temp, 0, 0);
  }, [images, target, analysis, sourceBox, state.scale, state.x, state.y]);

  useEffect(() => {
    if (!images || !target || !analysis || !sourceBox) return;
    const key = `${index}|${targetUrl}|${state.scale}|${state.x}|${state.y}`;
    latestKey.current = key;
    if (savedKey.current === key) return;
    const timer = setTimeout(async () => {
      const element = canvas.current;
      if (!element) return;
      setSaving(true);
      setSaveError("");
      try {
        const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("The keyframe could not be painted.");
        const asset = await uploadFile(new File([blob], `keyframe-${index}-${dateStamp()}.png`, { type: "image/png" }), "image");
        if (latestKey.current !== key) return;
        savedKey.current = key;
        onSaved(asset.id);
      } catch {
        if (latestKey.current !== key) return;
        savedKey.current = "";
        if (retry < 3) setRetry((value) => value + 1);
        else setSaveError("Could not save this keyframe. Adjust a slider to try again.");
      } finally {
        if (latestKey.current === key) setSaving(false);
      }
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, target, analysis, sourceBox, index, targetUrl, state.scale, state.x, state.y, retry]);

  return (
    <div className="ref-card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Keyframe at frame {index}</strong>
        <span className={`badge ${state.assetId ? "on" : ""}`}>{saving ? "saving..." : state.assetId ? "saved" : "waiting"}</span>
      </div>
      {loadError ? <p className="note err">{loadError}</p> : null}
      {saveError ? <p className="note err">{saveError}</p> : null}
      <canvas ref={canvas} />
      <div className="ctrls">
        <span>Scale</span>
        <input type="range" min={0.4} max={2} step={0.02} value={state.scale} onChange={(event) => onChange({ ...state, scale: Number(event.target.value), assetId: undefined })} />
        <span>Move X</span>
        <input type="range" min={-0.5} max={0.5} step={0.01} value={state.x} onChange={(event) => onChange({ ...state, x: Number(event.target.value), assetId: undefined })} />
        <span>Move Y</span>
        <input type="range" min={-0.5} max={0.5} step={0.01} value={state.y} onChange={(event) => onChange({ ...state, y: Number(event.target.value), assetId: undefined })} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small ghost" onClick={() => { savedKey.current = ""; onChange({ ...DEFAULT_TRANSFORM }); }}>
          Fit to character
        </button>
      </div>
    </div>
  );
}

export function PaintStep({
  jobId,
  frames,
  targetUrl,
  selected,
  onSelected,
  transforms,
  onTransform,
}: {
  jobId: string;
  frames: number;
  targetUrl: string;
  selected: number[];
  onSelected: (indices: number[]) => void;
  transforms: Record<number, RefTransform>;
  onTransform: (index: number, state: RefTransform) => void;
}) {
  const candidates = useMemo(() => candidateIndices(frames, 8), [frames]);

  const toggle = (index: number) => {
    if (selected.includes(index)) onSelected(selected.filter((value) => value !== index));
    else if (selected.length < 4) onSelected([...selected, index].sort((a, b) => a - b));
  };

  return (
    <div className="stack">
      <p className="note">
        Pick 1–4 frames to paint. Each frame becomes a pinned keyframe (<span className="mono">&lt;Picture N&gt;</span>) that fixes the
        new character's identity and composition. Two frames at the start and end of the shot is a good default.
      </p>
      <div className="filmstrip">
        {candidates.map((index) => (
          <button
            key={index}
            className={`thumb${selected.includes(index) ? " sel" : ""}`}
            onClick={() => toggle(index)}
            title={`Keyframe ${index}`}
          >
            <img src={`/api/jobs/${jobId}/frames/${index}?type=frame`} alt={`Frame ${index}`} loading="lazy" />
            <span className="n">f{index}</span>
            {selected.includes(index) ? <span className="tick">{selected.indexOf(index) + 1}</span> : null}
          </button>
        ))}
      </div>
      <p className="note">
        The character image is clipped to the SAM3 character area. The mask is grown by the selected margin, so the full figure can
        extend beyond the tight silhouette while the pose still comes from the source clip. If the area is still too tight, change
        the mask margin in step 02 and re-mask.
      </p>
      <div className="ref-grid">
        {selected.map((index) => (
          <RefEditor
            key={`${jobId}-${index}-${targetUrl}`}
            jobId={jobId}
            index={index}
            targetUrl={targetUrl}
            state={transforms[index] ?? DEFAULT_TRANSFORM}
            onChange={(state) => onTransform(index, state)}
            onSaved={(assetId) => onTransform(index, { ...(transforms[index] ?? DEFAULT_TRANSFORM), assetId })}
          />
        ))}
      </div>
      {selected.length === 0 ? <p className="note warn">Select at least one keyframe to continue.</p> : null}
    </div>
  );
}
