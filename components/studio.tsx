"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelJob, getAsset, postJson, useJob, useSamplingSteps } from "../lib/client-api.ts";
import { buildPrompt } from "../lib/prompt.ts";
import { bestFitFrames, candidateIndices, sourceFramesFor } from "../lib/frames.ts";
import { DEFAULT_MASK_MARGIN, MASK_MARGINS } from "../lib/margins.ts";
import { DEFAULT_HOLD_PRESET, holdThreshold, nearestHoldPreset, type HoldPresetId } from "../lib/keyframe-hold.ts";
import { clearRun, readRun, readSwapDraft, takePendingSource, takeRecipe, writeRun, writeSwapDraft, type SwapDraft } from "../lib/persistence.ts";
import type { Asset, ManualPoint, MaskMargin, SelectionMode } from "../lib/types.ts";
import { DropZone } from "./dropzone.tsx";
import { VideoSetup } from "./video-setup.tsx";
import { PointPicker } from "./point-picker.tsx";
import { MaskStep } from "./mask-step.tsx";
import { CutoutStep } from "./cutout-step.tsx";
import { PaintStep, type RefTransform } from "./paint-step.tsx";
import { RenderStep } from "./render-step.tsx";
import { AppFooter, AppHeader } from "./app-header.tsx";
import { StepNav, WizardFooter, useStepFocus, useWizardStep, type WizardStep } from "./wizard.tsx";

const DEFAULT_TRANSFORM: RefTransform = { scale: 1, x: 0, y: 0 };
const DEFAULT_REFERENCE_MODE: "direct" | "keyframes" = "direct";

const STEPS: WizardStep[] = [
  { label: "Source clip" },
  { label: "Character" },
  { label: "Reference" },
  { label: "Render" },
];

export function Studio() {
  const { step, go } = useWizardStep(STEPS.length);
  useStepFocus(step);
  const hydrating = useRef(false);
  const ready = useRef(false);
  const draftRef = useRef<SwapDraft | null>(null);
  const [video, setVideo] = useState<Asset | null>(null);
  const [start, setStart] = useState(0);
  const [frames, setFrames] = useState(90);

  const [target, setTarget] = useState<Asset | null>(null);
  const [rawTarget, setRawTarget] = useState<Asset | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [cutoutJobId, setCutoutJobId] = useState<string | null>(null);
  const [cutoutStarting, setCutoutStarting] = useState(false);
  const [cutoutError, setCutoutError] = useState<string | null>(null);
  const requestedCutout = useRef<string | null>(null);
  const cutoutRequest = useRef(0);
  const { job: cutoutJob, error: cutoutPollError } = useJob(cutoutJobId);
  const [description, setDescription] = useState("");
  const [role, setRole] = useState("the main person");
  const [action, setAction] = useState("");
  const [soundscape, setSoundscape] = useState("");
  const [mode, setMode] = useState<SelectionMode>("prompt");
  const [targetPrompt, setTargetPrompt] = useState("person");
  const [point, setPoint] = useState<ManualPoint | null>(null);
  const [maskMargin, setMaskMargin] = useState<MaskMargin>(DEFAULT_MASK_MARGIN);

  const [maskJobId, setMaskJobId] = useState<string | null>(null);
  const [maskStarting, setMaskStarting] = useState(false);
  const [maskError, setMaskError] = useState<string | null>(null);
  const { job: maskJob, error: maskPollError } = useJob(maskJobId);

  const [selected, setSelected] = useState<number[]>([]);
  const [transforms, setTransforms] = useState<Record<number, RefTransform>>({});
  const seeded = useRef<string | null>(null);

  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStarting, setRenderStarting] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const { job: renderJob, error: renderPollError } = useJob(renderJobId);
  const samplingSteps = useSamplingSteps("swap");

  const [shortEdge, setShortEdge] = useState(480);
  const [seed, setSeed] = useState(0);
  const [holdPreset, setHoldPreset] = useState<HoldPresetId>(DEFAULT_HOLD_PRESET);
  const [pinKeyframes, setPinKeyframes] = useState(true);
  const [referenceMode, setReferenceMode] = useState<"direct" | "keyframes">(DEFAULT_REFERENCE_MODE);
  const [promptText, setPromptText] = useState("");
  const [promptOverride, setPromptOverride] = useState(false);

  draftRef.current = {
    v: 1,
    videoId: video?.id,
    start,
    frames,
    targetAssetId: target?.id,
    rawTargetAssetId: rawTarget?.id,
    removeBackground,
    description,
    role,
    action,
    soundscape,
    mode,
    targetPrompt,
    point,
    maskMargin,
    maskJobId: maskJobId ?? undefined,
    referenceMode,
    selected,
    transforms,
    shortEdge,
    seed,
    holdPreset,
    pinKeyframes,
    promptText,
    promptOverride,
  };

  // Changing the source clip invalidates the mask, the painted keyframes and the render.
  useEffect(() => {
    if (hydrating.current) return;
    setMaskJobId(null);
    setMaskStarting(false);
    setMaskError(null);
    setSelected([]);
    setTransforms({});
    setRenderJobId(null);
    setRenderError(null);
    setPromptOverride(false);
    seeded.current = null;
  }, [video?.id, start, frames, maskMargin]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const recipe = takeRecipe("swap");
      if (recipe) {
        const source = await getAsset(recipe.videoId).catch(() => null);
        if (!active) return;
        if (!source) { ready.current = true; return; }
        const transforms: Record<number, RefTransform> = {};
        for (const ref of recipe.refs) {
          const asset = await getAsset(ref.assetId).catch(() => null);
          if (asset) transforms[ref.pin] = { ...DEFAULT_TRANSFORM, assetId: asset.id };
        }
        if (!active) return;
        clearRun("swap");
        hydrating.current = true;
        setVideo(source);
        setStart(recipe.start);
        setFrames(recipe.frames);
        setSeed(recipe.seed);
        setShortEdge(recipe.shortEdge);
        setPromptText(recipe.prompt);
        setPromptOverride(true);
        setPinKeyframes(recipe.pinKeyframes);
        setHoldPreset(nearestHoldPreset(recipe.keyframeUntil));
        setReferenceMode(recipe.referenceMode ?? (recipe.refs.length ? "keyframes" : "direct"));
        setSelected(recipe.refs.map((ref) => ref.pin).sort((a, b) => a - b));
        setTransforms(transforms);
        ready.current = true;
        return;
      }

      const sourceId = takePendingSource();
      const draft = readSwapDraft();

      if (draft) {
        const source = draft.videoId ? await getAsset(draft.videoId).catch(() => null) : null;
        const targetAsset = draft.targetAssetId ? await getAsset(draft.targetAssetId).catch(() => null) : null;
        const rawAsset = draft.rawTargetAssetId ? await getAsset(draft.rawTargetAssetId).catch(() => null) : null;
        let nextSource = source;
        let nextStart = draft.start;
        let nextFrames = draft.frames;
        if (sourceId) {
          const pending = await getAsset(sourceId).catch(() => null);
          if (pending) {
            nextSource = pending;
            nextStart = 0;
            nextFrames = bestFitFrames(pending.frames ?? sourceFramesFor(pending.duration ?? 0));
          }
        }
        if (!active) return;
        hydrating.current = true;
        seeded.current = draft.maskJobId ?? null;
        setVideo(nextSource);
        setStart(nextStart);
        setFrames(nextFrames);
        setTarget(targetAsset);
        setRawTarget(rawAsset ?? targetAsset);
        setRemoveBackground(draft.removeBackground);
        setDescription(draft.description);
        setRole(draft.role);
        setAction(draft.action);
        setSoundscape(draft.soundscape);
        setMode(draft.mode);
        setTargetPrompt(draft.targetPrompt);
        setPoint(draft.point);
        setMaskMargin(draft.maskMargin);
        setMaskJobId(draft.maskJobId ?? null);
        setReferenceMode(draft.referenceMode);
        setSelected(draft.selected);
        setTransforms(draft.transforms);
        setShortEdge(draft.shortEdge);
        setSeed(draft.seed);
        setHoldPreset(draft.holdPreset);
        setPinKeyframes(draft.pinKeyframes);
        setPromptText(draft.promptText);
        setPromptOverride(draft.promptOverride);
        const run = readRun("swap");
        if (run) setRenderJobId(run.jobId);
        ready.current = true;
        return;
      }

      if (sourceId) {
        const source = await getAsset(sourceId).catch(() => null);
        if (!active) return;
        if (!source) { ready.current = true; return; }
        clearRun("swap");
        hydrating.current = true;
        setVideo(source);
        setStart(0);
        setFrames(bestFitFrames(source.frames ?? sourceFramesFor(source.duration ?? 0)));
        ready.current = true;
        return;
      }

      const run = readRun("swap");
      if (!run) {
        ready.current = true;
        return;
      }
      const source = await getAsset(run.videoId).catch(() => null);
      if (!active || !source) {
        ready.current = true;
        return;
      }
      hydrating.current = true;
      setVideo(source);
      setStart(run.start);
      setFrames(run.frames);
      if (run.prompt) {
        setPromptText(run.prompt);
        setPromptOverride(true);
      }
      setRenderJobId(run.jobId);
      if (!new URLSearchParams(window.location.search).has("step")) go(STEPS.length - 1);
      ready.current = true;
    };
    void restore();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Let the restore effects run with the guard in place, then release it after the commit.
  useEffect(() => {
    if (!hydrating.current) return;
    const timer = setTimeout(() => { hydrating.current = false; }, 0);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    if (referenceMode !== "keyframes") return;
    if (maskJob?.status !== "succeeded" || seeded.current === maskJob.id) return;
    seeded.current = maskJob.id;
    const candidates = candidateIndices(frames, 8);
    const picks = [...new Set([candidates[1], candidates[Math.max(1, candidates.length - 2)]].filter((value) => value !== undefined))];
    setSelected(picks.sort((a, b) => a - b));
    setPromptOverride(false);
  }, [maskJob?.status, maskJob?.id, frames, referenceMode]);

  useEffect(() => {
    if (cutoutJob?.status !== "succeeded" || !cutoutJob.resultAssetId) return;
    if (requestedCutout.current !== cutoutJob.id) return;
    let active = true;
    getAsset(cutoutJob.resultAssetId)
      .then((asset) => {
        if (!active || requestedCutout.current !== cutoutJob.id) return;
        setTarget(asset);
      })
      .catch((reason) => {
        if (!active) return;
        setCutoutError(reason instanceof Error ? reason.message : "Could not load the background-removed image.");
      });
    return () => { active = false; };
  }, [cutoutJob?.status, cutoutJob?.resultAssetId, cutoutJob?.id]);

  useEffect(() => {
    if (cutoutJob?.status !== "failed") return;
    if (requestedCutout.current !== cutoutJob.id) return;
    setCutoutError(cutoutJob.error ?? "Background removal failed.");
  }, [cutoutJob?.status, cutoutJob?.error, cutoutJob?.id]);

  // A new character image needs new painted frames, even if the clip did not change.
  useEffect(() => {
    if (hydrating.current) return;
    setTransforms((previous) => {
      const next: Record<number, RefTransform> = {};
      for (const [key, value] of Object.entries(previous)) next[Number(key)] = { ...value, assetId: undefined };
      return next;
    });
  }, [target?.id]);

  useEffect(() => {
    setTransforms((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const index of selected) {
        if (!next[index]) {
          next[index] = { ...DEFAULT_TRANSFORM };
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [selected]);

  const generatePrompt = useCallback(() => buildPrompt({
    description,
    role,
    action,
    refCount: referenceMode === "direct" ? 1 : Math.max(1, selected.length),
    pins: referenceMode === "direct" ? [] : [...selected].sort((a, b) => a - b),
    frames,
    soundscape,
    direct: referenceMode === "direct",
  }), [description, role, action, selected, frames, soundscape, referenceMode]);

  const rebuildPrompt = useCallback(() => {
    setPromptText(generatePrompt());
  }, [generatePrompt]);

  const onPromptOverride = useCallback((value: boolean) => {
    setPromptOverride(value);
    if (!value) setPromptText(generatePrompt());
  }, [generatePrompt]);

  useEffect(() => {
    if (promptOverride) return;
    setPromptText(generatePrompt());
  }, [generatePrompt, promptOverride]);

  useEffect(() => {
    if (!ready.current) return;
    const timer = setTimeout(() => {
      if (draftRef.current) writeSwapDraft(draftRef.current);
    }, 200);
    return () => clearTimeout(timer);
  }, [
    video?.id, start, frames, target?.id, rawTarget?.id, removeBackground, description, role, action,
    soundscape, mode, targetPrompt, point, maskMargin, maskJobId, referenceMode, selected, transforms,
    shortEdge, seed, holdPreset, pinKeyframes, promptText, promptOverride,
  ]);

  useEffect(() => {
    const flush = () => {
      if (ready.current && draftRef.current) writeSwapDraft(draftRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const onTransform = useCallback((index: number, state: RefTransform) => {
    setTransforms((previous) => ({ ...previous, [index]: state }));
  }, []);

  const findCharacter = async () => {
    if (!video) { setMaskError("Upload a source video first."); return; }
    if (mode === "manual" && !point) { setMaskError("Click the character in the frame first."); return; }
    setMaskStarting(true);
    setMaskError(null);
    setMaskJobId(null);
    setSelected([]);
    setTransforms({});
    setRenderJobId(null);
    setPromptOverride(false);
    seeded.current = null;
    try {
      const data = await postJson<{ id: string }>("/api/mask", {
        videoId: video.id,
        start,
        frames,
        mode,
        target: targetPrompt,
        point,
        margin: maskMargin,
      });
      setMaskJobId(data.id);
    } catch (reason) {
      setMaskError(reason instanceof Error ? reason.message : "Unable to start the mask job.");
    } finally {
      setMaskStarting(false);
    }
  };

  const runCutout = async (asset: Asset) => {
    const request = ++cutoutRequest.current;
    setCutoutStarting(true);
    setCutoutError(null);
    setCutoutJobId(null);
    requestedCutout.current = null;
    try {
      const data = await postJson<{ id: string }>("/api/character/cutout", { assetId: asset.id });
      if (cutoutRequest.current !== request) return;
      requestedCutout.current = data.id;
      setCutoutJobId(data.id);
    } catch (reason) {
      if (cutoutRequest.current !== request) return;
      setCutoutError(reason instanceof Error ? reason.message : "Unable to start background removal.");
    } finally {
      if (cutoutRequest.current === request) setCutoutStarting(false);
    }
  };

  const onCharacterUpload = (asset: Asset) => {
    cutoutRequest.current++;
    setRawTarget(asset);
    setTarget(null);
    setCutoutError(null);
    setCutoutJobId(null);
    setCutoutStarting(false);
    requestedCutout.current = null;
    if (!removeBackground) { setTarget(asset); return; }
    void runCutout(asset);
  };

  const clearCharacter = () => {
    cutoutRequest.current++;
    requestedCutout.current = null;
    setRawTarget(null);
    setTarget(null);
    setCutoutError(null);
    setCutoutJobId(null);
    setCutoutStarting(false);
    setSelected([]);
    setTransforms({});
    setRenderJobId(null);
    setRenderError(null);
  };

  const onRemoveBackground = (value: boolean) => {
    setRemoveBackground(value);
    if (!value) {
      cutoutRequest.current++;
      requestedCutout.current = null;
      setCutoutJobId(null);
      setCutoutError(null);
      setCutoutStarting(false);
      if (rawTarget) setTarget(rawTarget);
      return;
    }
    if (rawTarget && !cutoutJobId && !cutoutStarting && target?.id === rawTarget.id) {
      setTarget(null);
      void runCutout(rawTarget);
    }
  };

  const useOriginal = () => {
    cutoutRequest.current++;
    requestedCutout.current = null;
    setCutoutJobId(null);
    setCutoutError(null);
    setCutoutStarting(false);
    if (rawTarget) setTarget(rawTarget);
  };

  const retryCutout = () => {
    if (!rawTarget) return;
    setTarget(null);
    void runCutout(rawTarget);
  };

  const cancelRender = async () => {
    if (!renderJobId) return;
    try {
      await cancelJob(renderJobId);
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : "Unable to cancel the render.");
    }
  };

  const cancelMask = async () => {
    if (!maskJobId) return;
    try {
      await cancelJob(maskJobId);
    } catch (reason) {
      setMaskError(reason instanceof Error ? reason.message : "Unable to cancel the mask job.");
    }
  };

  const cancelCutout = async () => {
    if (!cutoutJobId) return;
    try {
      await cancelJob(cutoutJobId);
    } catch (reason) {
      setCutoutError(reason instanceof Error ? reason.message : "Unable to cancel background removal.");
    }
  };

  const maskReady = maskJob?.status === "succeeded";
  const refs = referenceMode === "direct"
    ? (target ? [{ index: 0, assetId: target.id }] : [])
    : selected.map((index) => ({ index, assetId: transforms[index]?.assetId }));
  const refsReady = referenceMode === "direct" ? Boolean(target) : selected.length > 0 && refs.every((ref) => Boolean(ref.assetId));

  const render = async () => {
    if (!video || !refsReady) return;
    setRenderStarting(true);
    setRenderError(null);
    setRenderJobId(null);
    try {
      const data = await postJson<{ id: string }>("/api/render", {
        videoId: video.id,
        start,
        frames,
        refs: refs.map((ref) => ({ assetId: ref.assetId, pin: ref.index })),
        referenceMode,
        prompt: promptText,
        shortEdge,
        seed,
        keyframeUntil: referenceMode === "direct" ? 0 : holdThreshold(holdPreset),
        pinKeyframes: referenceMode === "direct" ? false : pinKeyframes,
      });
      setRenderJobId(data.id);
      writeRun("swap", { jobId: data.id, videoId: video.id, start, frames, prompt: promptText });
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : "Unable to start the render.");
    } finally {
      setRenderStarting(false);
    }
  };

  const characterStepDone = Boolean(target) && (referenceMode === "direct" || maskReady);
  const keyframeStepDone = refsReady;
  const characterPreview = target ?? rawTarget;
  const canUseOriginal = Boolean(rawTarget) && target?.id !== rawTarget?.id;
  const stepDone = [Boolean(video), characterStepDone, keyframeStepDone, renderJob?.status === "succeeded"];
  const referenceHint = !video
    ? "Upload a source video first."
    : !target
      ? "Add a character image first."
      : referenceMode === "direct"
        ? undefined
        : !maskReady
          ? "Mask the character to use painted keyframes."
          : !refsReady
            ? "Save each painted keyframe first."
            : undefined;
  const stepReady = [
    true,
    Boolean(video),
    Boolean(target) && (referenceMode === "direct" || maskReady) && (referenceMode === "direct" || refsReady),
    refsReady,
  ];
  const stepHints = [
    undefined,
    video ? undefined : "Upload a source video first.",
    referenceHint,
    !video ? "Upload a source video first." : referenceHint ?? "Finish the character reference first.",
  ];
  const navSteps: WizardStep[] = STEPS.map((item, index) => ({ ...item, ready: stepReady[index], hint: stepHints[index] }));
  const canAdvance = step < STEPS.length - 1 && navSteps[step + 1]?.ready !== false;
  const advanceHint = navSteps[step + 1]?.hint;

  return (
    <main className="shell">
      <AppHeader tab="swap" />
      <StepNav base="/" steps={navSteps} step={step} done={stepDone} onStep={go} />
      <p className="wizard-context note">
        {video ? `${video.name} · ${frames} frames` : "No source clip yet"}
        {target ? ` · ${target.name}` : ""}
        {refsReady ? " · reference ready" : ""}
      </p>

      <div className="layout">
        <section className="card" hidden={step !== 0} data-wizard-step="0">
          <div className="card-head">
            <div>
              <h2>Source clip</h2>
              <p className="hint">Upload a video and choose the window to remake. One Viggle Remake render covers 3.75–14.4 seconds.</p>
            </div>
          </div>
          <VideoSetup
            asset={video}
            onAsset={(asset) => {
              clearRun("swap");
              setVideo(asset);
              setStart(0);
              setFrames(bestFitFrames(asset.frames ?? sourceFramesFor(asset.duration ?? 0)));
            }}
            onClear={() => {
              clearRun("swap");
              setVideo(null);
              setStart(0);
              setFrames(90);
            }}
            start={start}
            onStart={setStart}
            frames={frames}
            onFrames={setFrames}
          />
        </section>

        <section className={`card${video ? "" : " dim"}`} hidden={step !== 1} data-wizard-step="1">
          <div className="card-head">
            <div>
              <h2>Character</h2>
              <p className="hint">Choose who to remove from the video and what should replace them. SAM tracks the selected person through the clip.</p>
            </div>
          </div>

          <div className="grid-2">
            <div className="stack">
              <div className="field">
                <label>Character image</label>
                {characterPreview ? (
                  <div>
                    <div className="media-wrap">
                      <img
                        className="media"
                        src={`/api/assets/${characterPreview.id}/file`}
                        alt={characterPreview.name}
                        style={{ maxHeight: 240, objectFit: "contain" }}
                      />
                      <button
                        type="button"
                        className="media-remove"
                        onClick={clearCharacter}
                        title="Remove character image"
                        aria-label="Remove character image"
                      >
                        ×
                      </button>
                    </div>
                    {target && rawTarget && target.id !== rawTarget.id ? (
                      <span className="badge on" style={{ display: "inline-block", marginTop: 8 }}>Background removed</span>
                    ) : null}
                  </div>
                ) : null}
                <DropZone
                  kind="image"
                  label={characterPreview ? "Replace character image" : "Drop a character image"}
                  hint="A clean, well-lit picture of the person or character. Transparent PNGs work well; otherwise the tracked silhouette clips the image."
                  accept="image/*"
                  onUpload={onCharacterUpload}
                />
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={removeBackground}
                    onChange={(event) => onRemoveBackground(event.target.checked)}
                  />
                  <span>Remove background with ComfyUI</span>
                </label>
                <span className="note">
                  Runs a matting pass and saves a transparent PNG with padding around the subject. The first use downloads the
                  configured matting model into ComfyUI.
                </span>
                <CutoutStep
                  job={cutoutJob}
                  error={cutoutError ?? (cutoutJobId ? cutoutPollError : null)}
                  starting={cutoutStarting}
                  canUseOriginal={canUseOriginal}
                  onRetry={retryCutout}
                  onUseOriginal={useOriginal}
                  onCancel={cancelCutout}
                />
              </div>
            </div>

            <div className="stack">
              <div className="field">
                <label htmlFor="description">Describe the character</label>
                <textarea
                  id="description"
                  className="textarea"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="e.g. a tall woman with short red hair, a black leather jacket, a white T-shirt and dark jeans"
                />
                <span className="note">This goes into the prompt and drives identity. Say enough to exclude anyone similar in frame.</span>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="role">Replaces</label>
                  <input id="role" className="input" value={role} onChange={(event) => setRole(event.target.value)} placeholder="the main person" />
                </div>
                <div className="field">
                  <label htmlFor="action">Action (optional)</label>
                  <input id="action" className="input" value={action} onChange={(event) => setAction(event.target.value)} placeholder="keeps dancing and turns to the camera" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="soundscape">Soundscape (optional)</label>
                <input
                  id="soundscape"
                  className="input"
                  value={soundscape}
                  onChange={(event) => setSoundscape(event.target.value)}
                  placeholder="The source soundtrack continues throughout."
                />
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="stack">
            <div className="field">
              <label>Find the character in the video</label>
              <div className="chips">
                <button className={`chip${mode === "prompt" ? " active" : ""}`} onClick={() => setMode("prompt")}>By prompt</button>
                <button className={`chip${mode === "manual" ? " active" : ""}`} onClick={() => setMode("manual")}>By clicking</button>
              </div>
            </div>

            {mode === "prompt" ? (
              <div className="field">
                <label htmlFor="targetPrompt">What SAM tracks</label>
                <input
                  id="targetPrompt"
                  className="input"
                  value={targetPrompt}
                  onChange={(event) => setTargetPrompt(event.target.value)}
                  placeholder="person, the dancer, a man in a red hoodie"
                />
                <span className="note">Describe the character in the video, not the new one. The largest match in the frame is replaced.</span>
              </div>
            ) : video ? (
              <PointPicker
                videoUrl={`/api/assets/${video.id}/file`}
                start={start}
                point={point}
                onPick={setPoint}
              />
            ) : (
              <p className="note">Upload a source video first.</p>
            )}

            <div className="field">
              <label>Mask margin</label>
              <div className="chips">
                {(Object.keys(MASK_MARGINS) as MaskMargin[]).map((key) => (
                  <button
                    key={key}
                    className={`chip${maskMargin === key ? " active" : ""}`}
                    onClick={() => setMaskMargin(key)}
                  >
                    {MASK_MARGINS[key].label}
                  </button>
                ))}
              </div>
              <span className="note">
                Loose grows SAM3's area so the character has room beyond the tight silhouette. Changing this clears the
                current mask; run the mask again.
              </span>
            </div>

            <div className="row">
              <button className="btn primary" onClick={findCharacter} disabled={!video || maskStarting}>
                {maskStarting ? "Starting..." : maskJob ? "Find character again" : "Mask the character"}
              </button>
              <span className="note">SAM 3.1 runs on the whole clip and returns a mask preview. Direct-image renders do not need it; painted keyframes do.</span>
            </div>

            <MaskStep job={maskJob} error={maskError ?? (maskJob ? null : maskPollError)} onCancel={cancelMask} />
          </div>
        </section>

        <section className={`card${(referenceMode === "direct" ? Boolean(target) : maskReady && Boolean(target)) ? "" : " dim"}`} hidden={step !== 2} data-wizard-step="2">
          <div className="card-head">
            <div>
              <h2>Character reference</h2>
              <p className="hint">Direct uses the character image itself and never pins it. Painted keyframes add source-frame compositions, but their pins can fight the source motion.</p>
            </div>
          </div>
          <div className="stack">
            <div className="field">
              <label>Reference mode</label>
              <div className="chips">
                <button className={`chip${referenceMode === "direct" ? " active" : ""}`} onClick={() => setReferenceMode("direct")}>Direct image (default)</button>
                <button className={`chip${referenceMode === "keyframes" ? " active" : ""}`} onClick={() => setReferenceMode("keyframes")}>Painted keyframes (optional)</button>
              </div>
              <span className="note">
                Direct: one clean character picture, no keyframes or pins. Keyframes: 1–4 composited source frames; their pins can hold the pose and override motion.
              </span>
            </div>

            {referenceMode === "direct" ? (
              !target ? (
                <p className="note">Add a character image first.</p>
              ) : (
                <div className="ref-grid">
                  <div className="ref-card">
                    <img
                      src={`/api/assets/${target.id}/file`}
                      alt={target.name}
                      style={{ width: "100%", maxHeight: 320, objectFit: "contain", background: "#000", borderRadius: 8, display: "block" }}
                    />
                    <p className="note" style={{ marginTop: 8 }}>
                      Used as <span className="mono">&lt;Picture 1&gt;</span>. The source clip supplies the pose, camera and timing; nothing is pinned.
                    </p>
                  </div>
                </div>
              )
            ) : !maskReady ? (
              <p className="note">Mask the character first.</p>
            ) : !target ? (
              <p className="note">Add a character image first.</p>
            ) : maskJob ? (
              <PaintStep
                jobId={maskJob.id}
                frames={frames}
                targetUrl={`/api/assets/${target.id}/file`}
                selected={selected}
                onSelected={setSelected}
                transforms={transforms}
                onTransform={onTransform}
              />
            ) : null}
          </div>
        </section>

        <section className={`card${refsReady ? "" : " dim"}`} hidden={step !== 3} data-wizard-step="3">
          <div className="card-head">
            <div>
              <h2>Render</h2>
              <p className="hint">Viggle Remake swaps the character and carries the source soundtrack. Edit the six-section prompt before you commit.</p>
            </div>
          </div>
          <RenderStep
            samplingSteps={samplingSteps}
            prompt={promptText}
            promptOverride={promptOverride}
            onPromptOverride={onPromptOverride}
            onPromptChange={setPromptText}
            onRebuild={rebuildPrompt}
            shortEdge={shortEdge}
            onShortEdge={setShortEdge}
            seed={seed}
            onSeed={setSeed}
            frames={frames}
            refCount={referenceMode === "direct" ? 1 : selected.length}
            refsReady={refsReady}
            direct={referenceMode === "direct"}
            holdPreset={holdPreset}
            onHoldPreset={setHoldPreset}
            pinKeyframes={pinKeyframes}
            onPinKeyframes={setPinKeyframes}
            busy={renderStarting}
            error={renderError ?? (renderJob ? null : renderPollError)}
            job={renderJob}
            onRender={render}
            onCancel={cancelRender}
          />
        </section>
      </div>

      <WizardFooter step={step} count={STEPS.length} onStep={go} canAdvance={canAdvance} hint={advanceHint} />
      <AppFooter />
    </main>
  );
}
