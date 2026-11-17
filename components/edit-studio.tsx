"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelJob, elapsedLabel, getAsset as fetchAsset, postJson, useJob, useSamplingSteps } from "../lib/client-api.ts";
import {
  buildEditPrompt,
  editDefaultRole,
  editKindInfo,
  isBareImageRequest,
  EDIT_KIND_INFO,
  EDIT_ROLE_INFO,
  type EditKind,
  type EditRole,
} from "../lib/edit-prompt.ts";
import { bestFitFrames, candidateIndices, sourceFramesFor } from "../lib/frames.ts";
import { DEFAULT_HOLD_PRESET, holdThreshold, nearestHoldPreset, type HoldPresetId } from "../lib/keyframe-hold.ts";
import { clearRun, readEditDraft, readRun, takePendingSource, takeRecipe, writeEditDraft, writeRun, type EditDraft } from "../lib/persistence.ts";
import type { Asset } from "../lib/types.ts";
import { AppFooter, AppHeader } from "./app-header.tsx";
import { StepNav, WizardFooter, useStepFocus, useWizardStep, type WizardStep } from "./wizard.tsx";
import { DropZone } from "./dropzone.tsx";
import { RenderStep } from "./render-step.tsx";
import { SourceFrameThumb } from "./source-frame-thumb.tsx";
import { VideoSetup } from "./video-setup.tsx";

type EditRef = {
  asset: Asset;
  pin: number;
  role: EditRole;
  roleLocked: boolean;
  caption?: string;
};

const STEPS: WizardStep[] = [
  { label: "Source clip" },
  { label: "Describe the edit" },
  { label: "Reference images", optional: true },
  { label: "Render" },
];

export function EditStudio() {
  const { step, go } = useWizardStep(STEPS.length);
  useStepFocus(step);
  const hydrating = useRef(false);
  const ready = useRef(false);
  const draftRef = useRef<EditDraft | null>(null);
  const [video, setVideo] = useState<Asset | null>(null);
  const [start, setStart] = useState(0);
  const [frames, setFrames] = useState(90);

  const [kind, setKind] = useState<EditKind>("remove");
  const [change, setChange] = useState("");
  const [keep, setKeep] = useState("");
  const [style, setStyle] = useState("");
  const [soundscape, setSoundscape] = useState("");

  const [refs, setRefs] = useState<EditRef[]>([]);
  const [shortEdge, setShortEdge] = useState(480);
  const [seed, setSeed] = useState(0);
  const [holdPreset, setHoldPreset] = useState<HoldPresetId>(DEFAULT_HOLD_PRESET);
  const [pinKeyframes, setPinKeyframes] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptOverride, setPromptOverride] = useState(false);

  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStarting, setRenderStarting] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const { job: renderJob, error: renderPollError } = useJob(renderJobId);
  const samplingSteps = useSamplingSteps("edit");

  const [captionQueue, setCaptionQueue] = useState<string[]>([]);
  const [captionTask, setCaptionTask] = useState<{ assetId: string; jobId: string } | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const captionStartLock = useRef(false);
  const { job: captionJob, error: captionPollError } = useJob(captionTask?.jobId ?? null);

  draftRef.current = {
    v: 1,
    videoId: video?.id,
    start,
    frames,
    kind,
    change,
    keep,
    style,
    soundscape,
    refs: refs.map((ref) => ({
      assetId: ref.asset.id,
      pin: ref.pin,
      role: ref.role,
      roleLocked: ref.roleLocked,
      caption: ref.caption,
    })),
    shortEdge,
    seed,
    holdPreset,
    pinKeyframes,
    promptText,
    promptOverride,
  };

  useEffect(() => {
    if (hydrating.current) return;
    setRefs([]);
    setRenderJobId(null);
    setRenderError(null);
    setPromptOverride(false);
  }, [video?.id]);

  useEffect(() => {
    let active = true;
    const restore = async () => {
      const recipe = takeRecipe("edit");
      if (recipe) {
        const source = await fetchAsset(recipe.videoId).catch(() => null);
        if (!active) return;
        if (!source) { ready.current = true; return; }
        const entries: EditRef[] = [];
        for (const ref of recipe.refs) {
          const asset = await fetchAsset(ref.assetId).catch(() => null);
          if (asset) entries.push({ asset, pin: ref.pin, role: "frame", roleLocked: true });
        }
        if (!active) return;
        clearRun("edit");
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
        setRefs(entries);
        ready.current = true;
        return;
      }

      const sourceId = takePendingSource();
      const draft = readEditDraft();

      if (draft) {
        const source = draft.videoId ? await fetchAsset(draft.videoId).catch(() => null) : null;
        const entries: EditRef[] = [];
        for (const ref of draft.refs) {
          const asset = await fetchAsset(ref.assetId).catch(() => null);
          if (asset) entries.push({ asset, pin: ref.pin, role: ref.role, roleLocked: ref.roleLocked, caption: ref.caption });
        }
        let nextSource = source;
        let nextStart = draft.start;
        let nextFrames = draft.frames;
        if (sourceId) {
          const pending = await fetchAsset(sourceId).catch(() => null);
          if (pending) {
            nextSource = pending;
            nextStart = 0;
            nextFrames = bestFitFrames(pending.frames ?? sourceFramesFor(pending.duration ?? 0));
          }
        }
        if (!active) return;
        hydrating.current = true;
        setVideo(nextSource);
        setStart(nextStart);
        setFrames(nextFrames);
        setKind(draft.kind);
        setChange(draft.change);
        setKeep(draft.keep);
        setStyle(draft.style);
        setSoundscape(draft.soundscape);
        setRefs(entries);
        setShortEdge(draft.shortEdge);
        setSeed(draft.seed);
        setHoldPreset(draft.holdPreset);
        setPinKeyframes(draft.pinKeyframes);
        setPromptText(draft.promptText);
        setPromptOverride(draft.promptOverride);
        const run = readRun("edit");
        if (run) setRenderJobId(run.jobId);
        ready.current = true;
        return;
      }

      if (sourceId) {
        const source = await fetchAsset(sourceId).catch(() => null);
        if (!active) return;
        if (!source) { ready.current = true; return; }
        clearRun("edit");
        hydrating.current = true;
        setVideo(source);
        setStart(0);
        setFrames(bestFitFrames(source.frames ?? sourceFramesFor(source.duration ?? 0)));
        ready.current = true;
        return;
      }

      const run = readRun("edit");
      if (!run) {
        ready.current = true;
        return;
      }
      const source = await fetchAsset(run.videoId).catch(() => null);
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

  useEffect(() => {
    if (hydrating.current) return;
    setRenderJobId(null);
    setRenderError(null);
  }, [start, frames]);

  // Let the restore effects run with the guard in place, then release it after the commit.
  useEffect(() => {
    if (!hydrating.current) return;
    const timer = setTimeout(() => { hydrating.current = false; }, 0);
    return () => clearTimeout(timer);
  });

  useEffect(() => {
    setRefs((previous) => previous.map((ref) => ({ ...ref, pin: Math.min(ref.pin, Math.max(0, frames - 1)) })));
  }, [frames]);

  // Pins can only be used when every reference is an edited source frame: the model
  // pins the first N references, so a background or object reference cannot be mixed in.
  const pinsAllowed = refs.length > 0 && refs.every((ref) => ref.role === "frame");
  const pinning = pinKeyframes && pinsAllowed;

  const generatePrompt = useCallback(() => buildEditPrompt({
    kind,
    change,
    keep,
    style,
    refs: refs.map((ref) => ({
      role: ref.role,
      caption: ref.caption,
      pin: pinning ? ref.pin : undefined,
    })),
    frames,
    soundscape,
  }), [kind, change, keep, style, refs, pinning, frames, soundscape]);

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

  // One caption job at a time. Queued references wait their turn, so uploading
  // several background/style pictures captions all of them instead of only the last.
  useEffect(() => {
    if (captionTask || captionStartLock.current) return;
    const assetId = captionQueue[0];
    if (!assetId) return;
    captionStartLock.current = true;
    void (async () => {
      try {
        const data = await postJson<{ id: string }>("/api/caption", { assetId });
        setCaptionQueue((previous) => previous.filter((id) => id !== assetId));
        setCaptionTask({ assetId, jobId: data.id });
      } catch (reason) {
        setCaptionQueue((previous) => previous.filter((id) => id !== assetId));
        setCaptionError(reason instanceof Error ? reason.message : "Unable to describe that image.");
      } finally {
        captionStartLock.current = false;
      }
    })();
  }, [captionQueue, captionTask]);

  useEffect(() => {
    if (!captionTask || captionJob?.status !== "succeeded" || !captionJob.resultText) return;
    if (captionJob.id !== captionTask.jobId) return;
    const text = captionJob.resultText.trim();
    const assetId = captionTask.assetId;
    setRefs((previous) => previous.map((ref) => (ref.asset.id === assetId ? { ...ref, caption: text } : ref)));
    setCaptionError(null);
    setCaptionTask(null);
  }, [captionTask, captionJob?.status, captionJob?.resultText, captionJob?.id]);

  useEffect(() => {
    if (!captionTask || captionJob?.status !== "failed") return;
    if (captionJob.id !== captionTask.jobId) return;
    setCaptionError(captionJob.error ?? "Could not describe that image.");
    setCaptionTask(null);
  }, [captionTask, captionJob?.status, captionJob?.error, captionJob?.id]);

  const describeImage = (asset: Asset) => {
    if (captionTask?.assetId === asset.id) return;
    setCaptionError(null);
    setCaptionQueue((previous) => (previous.includes(asset.id) ? previous : [...previous, asset.id]));
  };

  const addRef = (asset: Asset) => {
    const role = editDefaultRole(kind);
    setRefs((previous) => {
      if (previous.length >= 4) return previous;
      const candidates = candidateIndices(frames, 4);
      const pin = candidates[previous.length] ?? previous[previous.length - 1]?.pin ?? 0;
      return [...previous, {
        asset,
        pin: Math.min(pin, Math.max(0, frames - 1)),
        role,
        roleLocked: false,
      }];
    });
    // A background or style picture is the edit: describe it so the prompt can name the
    // target instead of saying "the image".
    if (role === "background" || role === "style") describeImage(asset);
  };

  const setRefRole = (index: number, role: EditRole) => {
    setRefs((previous) => previous.map((ref, i) => (i === index ? { ...ref, role, roleLocked: true } : ref)));
  };

  const updatePin = (index: number, pin: number) => {
    setRefs((previous) => previous.map((ref, i) => (i === index ? { ...ref, pin } : ref)));
  };

  const removeRef = (index: number) => {
    const assetId = refs[index]?.asset.id;
    setRefs((previous) => previous.filter((_, i) => i !== index));
    if (assetId) setCaptionQueue((previous) => previous.filter((id) => id !== assetId));
  };

  const clearCaption = (index: number) => {
    setRefs((previous) => previous.map((ref, i) => (i === index ? { ...ref, caption: undefined } : ref)));
  };

  const onKindChange = (next: EditKind) => {
    setKind((previous) => {
      const previousDefault = editDefaultRole(previous);
      const nextDefault = editDefaultRole(next);
      if (previousDefault !== nextDefault) {
        setRefs((current) => current.map((ref) => {
          if (ref.roleLocked || ref.role !== previousDefault) return ref;
          // A deliberate background or edited-frame role is never downgraded to a generic one.
          if (ref.role === "background" || ref.role === "frame") return ref;
          return { ...ref, role: nextDefault };
        }));
      }
      return next;
    });
  };

  useEffect(() => {
    if (!ready.current) return;
    const timer = setTimeout(() => {
      if (draftRef.current) writeEditDraft(draftRef.current);
    }, 200);
    return () => clearTimeout(timer);
  }, [
    video?.id, start, frames, kind, change, keep, style, soundscape, refs,
    shortEdge, seed, holdPreset, pinKeyframes, promptText, promptOverride,
  ]);

  useEffect(() => {
    const flush = () => {
      if (ready.current && draftRef.current) writeEditDraft(draftRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const hasCaption = refs.some((ref) => ref.caption?.trim());
  const cancelRender = async () => {
    if (!renderJobId) return;
    try {
      await cancelJob(renderJobId);
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : "Unable to cancel the render.");
    }
  };

  const briefReady = Boolean(change.trim()) || hasCaption || promptOverride;
  const canRender = Boolean(video) && briefReady;
  const render = async () => {
    if (!video || !canRender) return;
    setRenderStarting(true);
    setRenderError(null);
    setRenderJobId(null);
    try {
      const data = await postJson<{ id: string }>("/api/render", {
        mode: "edit",
        videoId: video.id,
        start,
        frames,
        refs: refs.map((ref) => ({ assetId: ref.asset.id, pin: ref.pin })),
        prompt: promptText,
        shortEdge,
        seed,
        keyframeUntil: pinning ? holdThreshold(holdPreset) : 0,
        pinKeyframes: pinning,
      });
      setRenderJobId(data.id);
      writeRun("edit", { jobId: data.id, videoId: video.id, start, frames, prompt: promptText });
    } catch (reason) {
      setRenderError(reason instanceof Error ? reason.message : "Unable to start the edit.");
    } finally {
      setRenderStarting(false);
    }
  };

  const info = editKindInfo(kind);
  const stepDone = [
    Boolean(video),
    briefReady,
    refs.length > 0,
    renderJob?.status === "succeeded",
  ];
  const stepReady = [true, Boolean(video), Boolean(video), Boolean(video) && briefReady];
  const stepHints = [
    undefined,
    video ? undefined : "Upload a source video first.",
    video ? undefined : "Upload a source video first.",
    !video ? "Upload a source video first." : !briefReady ? "Describe the edit first." : undefined,
  ];
  const navSteps: WizardStep[] = STEPS.map((item, index) => ({ ...item, ready: stepReady[index], hint: stepHints[index] }));
  const canAdvance = step < STEPS.length - 1 && navSteps[step + 1]?.ready !== false;
  const advanceHint = navSteps[step + 1]?.hint;

  return (
    <main className="shell">
      <AppHeader tab="edit" />
      <StepNav base="/edit" steps={navSteps} step={step} done={stepDone} onStep={go} />
      <p className="wizard-context note">
        {video ? `${video.name} · ${frames} frames` : "No source clip yet"}
        {change.trim()
          ? ` · "${change.trim().slice(0, 72)}${change.trim().length > 72 ? "…" : ""}"`
          : promptOverride
            ? " · manual prompt"
            : " · no instruction yet"}
        {refs.length ? ` · ${refs.length} reference image${refs.length === 1 ? "" : "s"}` : ""}
      </p>

      <div className="layout">
        <section className="card" hidden={step !== 0} data-wizard-step="0">
          <div className="card-head">
            <div>
              <h2>Source clip</h2>
              <p className="hint">Upload a video and choose the window to edit. One Viggle Remake render covers 3.75–14.4 seconds.</p>
            </div>
          </div>
          <VideoSetup
            asset={video}
            onAsset={(asset) => {
              clearRun("edit");
              setVideo(asset);
              setStart(0);
              setFrames(bestFitFrames(asset.frames ?? sourceFramesFor(asset.duration ?? 0)));
            }}
            onClear={() => {
              clearRun("edit");
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

        <section className="card" hidden={step !== 1} data-wizard-step="1">
          <div className="card-head">
            <div>
              <h2>Describe the edit</h2>
              <p className="hint">
                Pick what kind of edit this is and describe the result in your own words. The app builds the render prompt
                from these fields.
              </p>
            </div>
          </div>

          <div className="stack">
            <div className="field">
              <label>What kind of edit?</label>
              <div className="chips">
                {EDIT_KIND_INFO.map((option) => (
                  <button
                    key={option.kind}
                    className={`chip${kind === option.kind ? " active" : ""}`}
                    onClick={() => onKindChange(option.kind)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="brief">
              <div className="field">
                <label htmlFor="edit-change">{info.heading}</label>
                <textarea
                  id="edit-change"
                  className="textarea brief-input"
                  value={change}
                  onChange={(event) => setChange(event.target.value)}
                  placeholder={info.placeholder}
                />
                <span className="note">
                  {kind === "scene"
                    ? "Describe the new background in words. Upload a picture of it as a background reference, or use Describe image on that reference. The whole setting is replaced; the people, action and camera stay."
                    : "This is the instruction the edit follows. Describe the target, not the process: name what should be gone, or describe what should be there instead. The prompt below updates as you type."}
                </span>
                {kind === "scene" && isBareImageRequest(change) && !refs.some((ref) => ref.caption) ? (
                  <span className="note warn">
                    “{change}” does not describe the target. Describe the new background in words, or let Describe image
                    write that description for you.
                  </span>
                ) : null}
                {kind === "scene" && isBareImageRequest(change) && refs.some((ref) => ref.caption) ? (
                  <span className="note">
                    The picture description below is used as the new setting, so the edit is applied to the whole background.
                  </span>
                ) : null}
              </div>
              <div className="row examples">
                <span className="note">Try an example:</span>
                {EDIT_KIND_INFO.map((option) => (
                  <button
                    key={option.kind}
                    className="chip"
                    onClick={() => { onKindChange(option.kind); setChange(option.example); }}
                  >
                    {option.exampleLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label htmlFor="edit-keep">Preserve (optional)</label>
                <input
                  id="edit-keep"
                  className="input"
                  value={keep}
                  onChange={(event) => setKeep(event.target.value)}
                  placeholder={info.keepPlaceholder}
                />
                <span className="note">Left empty, {info.defaultKeep} are preserved.</span>
              </div>
              <div className="field">
                <label htmlFor="edit-style">Style / look (optional)</label>
                <input
                  id="edit-style"
                  className="input"
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                  placeholder="cinematic, low winter light, soft overcast sky"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="edit-sound">Soundscape (optional)</label>
              <input
                id="edit-sound"
                className="input"
                value={soundscape}
                onChange={(event) => setSoundscape(event.target.value)}
                placeholder="The source soundtrack continues throughout."
              />
            </div>

          </div>
        </section>

        <section className="card" hidden={step !== 2} data-wizard-step="2">
          <div className="card-head">
            <div>
              <h2>Reference images</h2>
              <p className="hint">
                Optional: add up to four pictures that show the target, and give each one a role. With no image, the app
                uses a source frame as the model&apos;s required reference and your instruction carries the edit.
              </p>
            </div>
          </div>

          <div className="stack">
            <div className="field">
              <label>Images (1–4, optional)</label>
              <span className="note">
                A background or style picture is described automatically. Give each image a role so the prompt uses it
                correctly.
              </span>
            </div>

            <div className="ref-grid">
              {refs.map((ref, index) => {
                const roleInfo = EDIT_ROLE_INFO.find((option) => option.role === ref.role) ?? EDIT_ROLE_INFO[0];
                return (
                  <div className="ref-card" key={ref.asset.id}>
                    <div className="row between" style={{ marginBottom: 8 }}>
                      <strong style={{ fontSize: 13 }}>Reference image {index + 1}</strong>
                      <div className="row" style={{ gap: 6 }}>
                        {(() => {
                          const describing = captionTask?.assetId === ref.asset.id;
                          const queued = captionQueue.includes(ref.asset.id);
                          return (
                            <button
                              className="btn small ghost"
                              onClick={() => describeImage(ref.asset)}
                              disabled={describing || queued}
                            >
                              {describing ? "Describing..." : queued ? "Queued..." : "Describe image"}
                            </button>
                          );
                        })()}
                        <button className="btn small danger" onClick={() => removeRef(index)}>Remove</button>
                      </div>
                    </div>
                    <img
                      className="media"
                      src={`/api/assets/${ref.asset.id}/file`}
                      alt={ref.asset.name}
                      style={{ maxHeight: 230, objectFit: "contain" }}
                    />

                    <div className="field" style={{ marginTop: 10 }}>
                      <label>Role</label>
                      <div className="chips">
                        {EDIT_ROLE_INFO.map((option) => (
                          <button
                            key={option.role}
                            className={`chip${ref.role === option.role ? " active" : ""}`}
                            onClick={() => setRefRole(index, option.role)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <span className="note">{roleInfo.hint}</span>
                    </div>

                    {ref.caption ? (
                      <div className="field" style={{ marginTop: 10 }}>
                        <label>Suggested description</label>
                        <span className="note">{ref.caption}</span>
                        <div className="row" style={{ gap: 6, marginTop: 6 }}>
                          <button className="btn small ghost" onClick={() => setChange(ref.caption ?? "")}>Use as the instruction</button>
                          <button className="btn small ghost" onClick={() => clearCaption(index)}>Dismiss</button>
                        </div>
                      </div>
                    ) : null}

                    {ref.role === "frame" ? (
                      <div className="grid-2" style={{ marginTop: 10 }}>
                        <div className="field">
                          <label htmlFor={`pin-${index}`}>Pin to source frame</label>
                          <input
                            id={`pin-${index}`}
                            type="range"
                            min={0}
                            max={Math.max(0, frames - 1)}
                            step={1}
                            value={ref.pin}
                            onChange={(event) => updatePin(index, Number(event.target.value))}
                          />
                          <span className="note">Frame {ref.pin} · {(ref.pin / 24).toFixed(2)} s</span>
                        </div>
                        <div className="field">
                          <label>Source frame</label>
                          {video ? (
                            <SourceFrameThumb videoUrl={`/api/assets/${video.id}/file`} time={start + ref.pin / 24} />
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {captionTask || captionQueue.length > 0 ? (
              <p className="note">
                {captionTask
                  ? `Describing reference image ${Math.max(1, refs.findIndex((ref) => ref.asset.id === captionTask.assetId) + 1)}${
                      captionJob ? `... ${elapsedLabel(captionJob.elapsed)}` : "..."
                    }`
                  : `Waiting to describe ${captionQueue.length} reference image${captionQueue.length === 1 ? "" : "s"}...`}
              </p>
            ) : null}
            {captionError || (captionTask ? captionPollError : null) ? (
              <p className="note err">{captionError ?? captionPollError}</p>
            ) : null}

            {refs.length < 4 ? (
              <DropZone
                kind="image"
                label={refs.length ? "Add another reference image" : "Add a reference image (optional)"}
                hint="Optional. A picture of the new background, the new object look, a style, or an edited source frame. PNG, JPEG or WebP. Up to four."
                accept="image/*"
                onUpload={addRef}
              />
            ) : (
              <p className="note">Four reference images is the maximum.</p>
            )}

            {refs.length > 0 && !pinsAllowed ? (
              <p className="note">
                Pinning needs every reference to be an edited source frame, because the model pins references in order.
                Mix in a background, object or style reference and the render uses references only.
              </p>
            ) : null}
          </div>
        </section>

        <section className={`card${canRender ? "" : " dim"}`} hidden={step !== 3} data-wizard-step="3">
          <div className="card-head">
            <div>
              <h2>Render</h2>
              <p className="hint">Viggle Remake applies the edit and carries the source soundtrack. The prompt is generated from the request; you can override it if needed.</p>
            </div>
          </div>
          <RenderStep
            samplingSteps={samplingSteps}
            kind="edit"
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
            refCount={refs.length}
            refsReady={refs.length > 0}
            ready={canRender}
            direct={false}
            holdPreset={holdPreset}
            onHoldPreset={setHoldPreset}
            pinKeyframes={pinKeyframes}
            onPinKeyframes={setPinKeyframes}
            pinsAllowed={pinsAllowed}
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
