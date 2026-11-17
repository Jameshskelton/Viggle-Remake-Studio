"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MAX_SAMPLING_STEPS,
  MIN_SAMPLING_STEPS,
  type AppSettings,
  type LoraSelection,
} from "../lib/model-settings.ts";
import { AppFooter, AppHeader } from "./app-header.tsx";

type Models = {
  unets: string[];
  clips: string[];
  loras: string[];
  vaes: string[];
};

type Payload = {
  settings: AppSettings;
  defaults: AppSettings;
  models: Models | null;
  modelsError?: string | null;
  error?: string;
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function ModelSelect({
  id,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {!value ? <option value="" disabled>Select a model…</option> : null}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
        {value && !options.includes(value) ? <option value={value}>{value}</option> : null}
      </select>
      {hint ? <span className="note">{hint}</span> : null}
    </div>
  );
}

function LoraEditor({
  id,
  label,
  hint,
  loras,
  options,
  onChange,
  onAdd,
  onRemove,
}: {
  id: string;
  label: string;
  hint: string;
  loras: LoraSelection[];
  options: string[];
  onChange: (index: number, value: LoraSelection) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {loras.length === 0 ? <span className="note">None.</span> : null}
      {loras.length > 0 ? (
        <div className="stack" style={{ gap: 8, marginTop: 6 }}>
          {loras.map((lora, index) => (
            <div className="row" key={`${id}-${index}`}>
              <select
                className="select grow"
                value={lora.name}
                onChange={(event) => onChange(index, { ...lora, name: event.target.value })}
                aria-label={`${label} ${index + 1}`}
              >
                {!lora.name ? <option value="" disabled>Select a LoRA…</option> : null}
                {lora.name && !options.includes(lora.name) ? <option value={lora.name}>{lora.name}</option> : null}
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input
                className="input"
                type="number"
                min={-2}
                max={2}
                step={0.05}
                value={lora.strength}
                onChange={(event) => onChange(index, { ...lora, strength: Number(event.target.value) })}
                aria-label={`${label} ${index + 1} strength`}
                style={{ maxWidth: 100 }}
              />
              <button className="btn small ghost" type="button" onClick={() => onRemove(index)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" type="button" onClick={onAdd} disabled={options.length === 0}>
          Add LoRA
        </button>
        <span className="note">{options.length === 0 ? "No LoRAs found in ComfyUI." : hint}</span>
      </div>
    </div>
  );
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [defaults, setDefaults] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (applySettings = true) => {
    setLoading(true);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = await response.json() as Payload;
      if (!response.ok) throw new Error(data.error ?? "Unable to read the settings.");
      if (applySettings) {
        setSettings(data.settings);
        setDefaults(data.defaults);
      }
      setModels(data.models);
      setModelsError(data.modelsError ?? null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to read the settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json() as { settings?: AppSettings; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error ?? "Unable to save the settings.");
      setSettings(data.settings);
      setStatus("Saved. New renders will use these models and settings.");
      window.dispatchEvent(new Event("viggle:settings"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the settings.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!defaults) return;
    setSettings(defaults);
    setError(null);
    setStatus("Defaults loaded. Save to apply them.");
  };

  const reloadModels = async () => {
    await load(false);
    setStatus("Model list reloaded from ComfyUI.");
  };

  if (!settings) {
    return (
      <main className="shell">
        <AppHeader tab="settings" />
        <section className="card">
          {error ? <p className="note err">{error}</p> : <p className="note">Loading settings…</p>}
        </section>
        <AppFooter />
      </main>
    );
  }

  const updateField = (key: keyof AppSettings, value: string | number) => {
    setSettings((previous) => (previous ? { ...previous, [key]: value } : previous));
    setStatus(null);
  };

  const addLora = (key: "swapLoras" | "editLoras", options: string[]) => {
    setSettings((previous) => {
      if (!previous) return previous;
      const used = new Set(previous[key].map((lora) => lora.name));
      const name = options.find((option) => !used.has(option)) ?? options[0] ?? "";
      return { ...previous, [key]: [...previous[key], { name, strength: 1 }] };
    });
    setStatus(null);
  };

  const updateLora = (key: "swapLoras" | "editLoras", index: number, value: LoraSelection) => {
    setSettings((previous) => previous
      ? { ...previous, [key]: previous[key].map((lora, i) => (i === index ? value : lora)) }
      : previous);
    setStatus(null);
  };

  const removeLora = (key: "swapLoras" | "editLoras", index: number) => {
    setSettings((previous) => previous
      ? { ...previous, [key]: previous[key].filter((_, i) => i !== index) }
      : previous);
    setStatus(null);
  };

  const setSteps = (key: "swapSteps" | "editSteps", raw: string) => {
    const value = Math.min(
      MAX_SAMPLING_STEPS,
      Math.max(MIN_SAMPLING_STEPS, Math.round(Number(raw) || MIN_SAMPLING_STEPS)),
    );
    updateField(key, value);
  };

  const unets = unique([
    ...(models?.unets ?? []),
    settings.swapDiffusion,
    settings.swapBase,
    settings.editBase,
  ]);
  const clips = unique([...(models?.clips ?? []), settings.textEncoder]);
  const loras = unique([
    ...(models?.loras ?? []),
    ...settings.swapLoras.map((lora) => lora.name),
    ...settings.editLoras.map((lora) => lora.name),
  ]);
  const vaes = unique([...(models?.vaes ?? []), settings.videoVae, settings.audioVae]);
  const valid = Boolean(
    settings.swapDiffusion
    && settings.swapBase
    && settings.editBase
    && settings.textEncoder
    && settings.videoVae
    && settings.audioVae
    && Number.isInteger(settings.swapSteps)
    && settings.swapSteps >= MIN_SAMPLING_STEPS
    && settings.swapSteps <= MAX_SAMPLING_STEPS
    && Number.isInteger(settings.editSteps)
    && settings.editSteps >= MIN_SAMPLING_STEPS
    && settings.editSteps <= MAX_SAMPLING_STEPS
    && settings.swapLoras.every((lora) => lora.name && Number.isFinite(lora.strength) && lora.strength >= -2 && lora.strength <= 2)
    && settings.editLoras.every((lora) => lora.name && Number.isFinite(lora.strength) && lora.strength >= -2 && lora.strength <= 2),
  );
  const swapLoraText = settings.swapLoras.map((lora) => `${lora.name} (${lora.strength})`).join(" + ");
  const editLoraText = settings.editLoras.map((lora) => `${lora.name} (${lora.strength})`).join(" + ");

  return (
    <main className="shell">
      <AppHeader tab="settings" />

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Swap models</h2>
              <p className="hint">Used by the Swap character tab. Any swap LoRA switches the render from the merged transformer to the base model plus the LoRA chain.</p>
            </div>
          </div>
          <div className="grid-2">
            <ModelSelect
              id="swap-diffusion"
              label="Swap diffusion model"
              hint="The merged Viggle Remake swap transformer. Ignored when at least one swap LoRA is added."
              value={settings.swapDiffusion}
              options={unets}
              onChange={(value) => updateField("swapDiffusion", value)}
            />
            <div className="field">
              <label htmlFor="swap-steps">Swap sampling steps</label>
              <input
                id="swap-steps"
                className="input"
                type="number"
                min={MIN_SAMPLING_STEPS}
                max={MAX_SAMPLING_STEPS}
                step={1}
                value={settings.swapSteps}
                onChange={(event) => setSteps("swapSteps", event.target.value)}
              />
              <span className="note">6 matches the model card. Other counts resample the same sigma curve.</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <LoraEditor
              id="swap-loras"
              label="Swap LoRAs"
              hint="Each LoRA is applied in order. Strength 1.0 is neutral."
              loras={settings.swapLoras}
              options={loras}
              onChange={(index, value) => updateLora("swapLoras", index, value)}
              onAdd={() => addLora("swapLoras", loras)}
              onRemove={(index) => removeLora("swapLoras", index)}
            />
          </div>
          {settings.swapLoras.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <ModelSelect
                id="swap-base"
                label="Swap base model"
                hint="Loaded with the selected swap LoRAs. Use the base transformer."
                value={settings.swapBase}
                options={unets}
                onChange={(value) => updateField("swapBase", value)}
              />
            </div>
          ) : null}
          <p className="note mono" style={{ marginTop: 10 }}>
            Swap uses {settings.swapLoras.length > 0 ? `${settings.swapBase} + ${swapLoraText}` : settings.swapDiffusion}.
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Edit models</h2>
              <p className="hint">Used by the Edit video tab. The edit LoRA chain is applied on top of the edit base transformer.</p>
            </div>
          </div>
          <div className="grid-2">
            <ModelSelect
              id="edit-base"
              label="Edit base diffusion model"
              hint="The MiniMax H3 transformer for edit renders. Use the base transformer, not the merged swap file."
              value={settings.editBase}
              options={unets}
              onChange={(value) => updateField("editBase", value)}
            />
            <div className="field">
              <label htmlFor="edit-steps">Edit sampling steps</label>
              <input
                id="edit-steps"
                className="input"
                type="number"
                min={MIN_SAMPLING_STEPS}
                max={MAX_SAMPLING_STEPS}
                step={1}
                value={settings.editSteps}
                onChange={(event) => setSteps("editSteps", event.target.value)}
              />
              <span className="note">6 matches the model card. Other counts resample the same sigma curve.</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <LoraEditor
              id="edit-loras"
              label="Edit LoRAs"
              hint="Each LoRA is applied in order. Leave empty to run the base model alone."
              loras={settings.editLoras}
              options={loras}
              onChange={(index, value) => updateLora("editLoras", index, value)}
              onAdd={() => addLora("editLoras", loras)}
              onRemove={(index) => removeLora("editLoras", index)}
            />
          </div>
          <p className="note mono" style={{ marginTop: 10 }}>
            Edit uses {settings.editBase}{settings.editLoras.length > 0 ? ` + ${editLoraText}` : " without a LoRA"}.
          </p>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Shared weights</h2>
              <p className="hint">The text encoder and VAEs loaded by both swap and edit renders.</p>
            </div>
          </div>
          <ModelSelect
            id="text-encoder"
            label="Text encoder"
            hint="CLIPLoader model for the six-section prompt. Use a MiniMax H3-compatible encoder."
            value={settings.textEncoder}
            options={clips}
            onChange={(value) => updateField("textEncoder", value)}
          />
          <div className="grid-2" style={{ marginTop: 14 }}>
            <ModelSelect
              id="video-vae"
              label="Video VAE"
              hint="Decodes the generated frames."
              value={settings.videoVae}
              options={vaes}
              onChange={(value) => updateField("videoVae", value)}
            />
            <ModelSelect
              id="audio-vae"
              label="Audio VAE"
              hint="Decodes the generated soundtrack."
              value={settings.audioVae}
              options={vaes}
              onChange={(value) => updateField("audioVae", value)}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Apply</h2>
              <p className="hint">
                Changes apply to new renders immediately; jobs already queued or running keep the models they started with.
                Overrides are stored in <span className="mono">data/settings.json</span>.
              </p>
            </div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={save} disabled={saving || loading || !valid}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button className="btn ghost" onClick={reset} disabled={saving || loading || !defaults}>
              Load defaults
            </button>
            <button className="btn ghost" onClick={() => void reloadModels()} disabled={saving || loading}>
              {loading ? "Loading…" : "Reload models"}
            </button>
          </div>
          {status ? <p className="note" role="status" aria-live="polite" style={{ marginTop: 10 }}>{status}</p> : null}
          {error ? <p className="note err" style={{ marginTop: 10 }}>{error}</p> : null}
          {modelsError ? (
            <p className="note warn" style={{ marginTop: 10 }}>
              The model list could not be read from ComfyUI: {modelsError} You can save the current values, but new choices
              need ComfyUI online.
            </p>
          ) : null}
          {!valid ? (
            <p className="note err" style={{ marginTop: 10 }}>
              Fill every model field and use valid LoRA strengths and step counts before saving.
            </p>
          ) : null}
        </section>
      </div>

      <AppFooter />
    </main>
  );
}
