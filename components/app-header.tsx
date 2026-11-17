"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CapabilityKey = "swap" | "edit" | "mask" | "cutout" | "caption";
type Capability = { ready: boolean; missing: string[] };

export type Health = {
  comfyui: boolean;
  device?: string | null;
  version?: string | null;
  queue?: { running: number; pending: number };
  capabilities?: Record<CapabilityKey, Capability>;
  error?: string;
};

const CAPABILITY_LABELS: Record<CapabilityKey, string> = {
  swap: "Swap",
  edit: "Edit",
  mask: "Mask",
  cutout: "Cutout",
  caption: "Describe image",
};

const TAB_CAPABILITIES: Record<"swap" | "edit" | "renders" | "storage" | "settings", CapabilityKey[]> = {
  swap: ["swap", "mask", "cutout"],
  edit: ["edit", "caption"],
  renders: ["swap", "edit"],
  storage: [],
  settings: ["swap", "edit"],
};

export function useHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const data = await response.json() as Health;
        if (active) setHealth(data);
      } catch {
        if (active) setHealth({ comfyui: false, error: "ComfyUI is not reachable." });
      }
    };
    load();
    const timer = setInterval(load, 15000);
    const onSettings = () => { void load(); };
    window.addEventListener("viggle:settings", onSettings);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("viggle:settings", onSettings);
    };
  }, []);
  return health;
}

export function AppHeader({ tab }: { tab: "swap" | "edit" | "renders" | "storage" | "settings" }) {
  const health = useHealth();
  const capabilityKeys = TAB_CAPABILITIES[tab];
  const capabilities = health?.capabilities;
  const missingCapabilities = capabilities
    ? capabilityKeys.filter((key) => !capabilities[key].ready)
    : [];

  return (
    <header className="hero">
      <div>
        <h1>Viggle Remake Studio</h1>
        <p className="lede">
          {tab === "swap"
            ? "Pick a character in a video, mask them with SAM 3.1, then let Viggle Remake re-shoot the shot on your own GPU. Motion, camera, cuts and soundtrack stay."
            : tab === "edit"
              ? "Change objects, weather, light, setting or style in a clip. Write the edit, add reference images if you have them, then let Viggle Remake re-shoot the shot on your own GPU. Motion, camera, cuts and soundtrack stay."
              : tab === "renders"
                ? "Every render this app has submitted, newest first. Play or download a result, reuse its settings, or use it as the source for the next run."
                : tab === "storage"
                  ? "See how much space the app and ComfyUI use, then clean assets and cached clips that no job or open draft needs."
                  : "Choose the diffusion models, text encoder, VAEs and LoRAs used by new renders. Changes apply without restarting the app."}
        </p>
        <nav className="tabs" aria-label="Workspace">
          <Link className={`tab${tab === "swap" ? " active" : ""}`} href="/">Swap character</Link>
          <Link className={`tab${tab === "edit" ? " active" : ""}`} href="/edit">Edit video</Link>
          <Link className={`tab${tab === "renders" ? " active" : ""}`} href="/renders">Renders</Link>
          <Link className={`tab${tab === "storage" ? " active" : ""}`} href="/storage">Storage</Link>
          <Link className={`tab${tab === "settings" ? " active" : ""}`} href="/settings">Advanced</Link>
        </nav>
        <div className="badge-row">
          <span className={`badge ${health ? (health.comfyui ? "on" : "off") : ""}`}>
            {health ? (health.comfyui ? "ComfyUI online" : "ComfyUI offline") : "Checking ComfyUI…"}
          </span>
          {health?.device ? <span className="badge">{health.device}</span> : null}
          {health?.version ? <span className="badge">ComfyUI {health.version}</span> : null}
          {health?.comfyui && health.queue ? (
            <span className="badge">
              {health.queue.running ? `${health.queue.running} running` : "GPU idle"}
              {health.queue.pending ? ` · ${health.queue.pending} queued` : ""}
            </span>
          ) : null}
          {health?.comfyui && capabilities
            ? capabilityKeys.map((key) => {
                const capability = capabilities[key];
                return (
                  <span
                    key={key}
                    className={`badge ${capability.ready ? "on" : "off"}`}
                    title={capability.missing.length ? capability.missing.join(", ") : undefined}
                  >
                    {CAPABILITY_LABELS[key]} {capability.ready ? "ready" : "missing"}
                  </span>
                );
              })
            : null}
        </div>
        {health && !health.comfyui ? (
          <p className="note err" style={{ marginTop: 8 }}>
            Start ComfyUI at the address in <span className="mono">COMFYUI_URL</span> and reload. {health.error}
          </p>
        ) : null}
        {health?.comfyui && missingCapabilities.length ? (
          <p className="note warn" style={{ marginTop: 8 }}>
            Some features are missing: {missingCapabilities.map((key) => CAPABILITY_LABELS[key]).join(", ")}. Hover a red
            badge for the missing files or nodes.
          </p>
        ) : null}
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="honor">
      <div>Powered by <a href="https://huggingface.co/Viggle/Viggle-Remake" target="_blank" rel="noreferrer">Viggle Remake</a> · MiniMax H3.</div>
      <div>Use only footage you have the right to change, and label generated video as AI-generated.</div>
    </footer>
  );
}
