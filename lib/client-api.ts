"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SAMPLING_STEPS, MAX_SAMPLING_STEPS, MIN_SAMPLING_STEPS } from "./model-settings.ts";
import type { Asset, AssetKind, JobSummary, JobView } from "./types.ts";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text.slice(0, 300) };
  }
}

export function uploadFile(file: File, kind: AssetKind, onProgress?: (fraction: number) => void): Promise<Asset> {
  const body = new FormData();
  body.append("file", file);
  body.append("kind", kind);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/assets");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(request.responseText) as Record<string, unknown>;
      } catch {
        data = { error: request.responseText.slice(0, 300) };
      }
      if (request.status >= 200 && request.status < 300 && data.asset) {
        resolve(data.asset as Asset);
        return;
      }
      reject(new Error(typeof data.error === "string" ? data.error : "Upload failed."));
    };
    request.onerror = () => reject(new Error("Upload failed."));
    request.onabort = () => reject(new Error("Upload cancelled."));
    request.send(body);
  });
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
  return data as T;
}

export type DeleteRendersResult = {
  deleted: number;
  skipped: number;
  removedAssets: number;
  removedClips: number;
  removedComfy: number;
  freedBytes: number;
};

export async function getRenderJobs(limit = 200): Promise<JobSummary[]> {
  const response = await fetch(`/api/jobs?limit=${limit}`, { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to read the render history.");
  return (data.jobs ?? []) as JobSummary[];
}

export async function clearClipCache(): Promise<{ removedClips: number; freedBytes: number }> {
  return postJson("/api/storage/clips", {});
}

export type PurgeResult = {
  removedAssets: number;
  removedJobs: number;
  removedClips: number;
  removedComfy: number;
  removedSettings: boolean;
  freedBytes: number;
};

export async function purgeAppData(input: {
  confirm: "DELETE";
  cleanComfy: boolean;
  resetSettings: boolean;
}): Promise<PurgeResult> {
  return postJson("/api/storage/purge", input);
}

export async function deleteRenders(input: {
  ids?: string[];
  mode?: "swap" | "edit";
  all?: boolean;
  keepAssetIds?: string[];
}): Promise<DeleteRendersResult> {
  return postJson<DeleteRendersResult>("/api/renders/delete", input);
}

export async function cancelJob(id: string): Promise<void> {
  const response = await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
  const data = await readJson(response);
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to cancel the job.");
}

export async function getAsset(id: string): Promise<Asset> {
  const response = await fetch(`/api/assets/${id}`, { cache: "no-store" });
  const data = await readJson(response);
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to read that image.");
  return data.asset as Asset;
}

export function useJob(id: string | null) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
        const data = await readJson(response);
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Unable to read the job.");
        if (!active) return;
        setJob(data as JobView);
        setError(null);
        if (data.status !== "succeeded" && data.status !== "failed" && data.status !== "cancelled") timer = setTimeout(load, 1500);
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Lost the job.");
        timer = setTimeout(load, 2500);
      }
    };

    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);

  return { job, error };
}

export function useSamplingSteps(mode: "swap" | "edit") {
  const [steps, setSteps] = useState(DEFAULT_SAMPLING_STEPS);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/settings?models=0", { cache: "no-store" });
        const data = await response.json() as { settings?: { swapSteps?: number; editSteps?: number } };
        const value = mode === "edit" ? data.settings?.editSteps : data.settings?.swapSteps;
        if (active && typeof value === "number" && Number.isInteger(value) && value >= MIN_SAMPLING_STEPS && value <= MAX_SAMPLING_STEPS) {
          setSteps(value);
        }
      } catch {
        // Keep the default when the settings cannot be read.
      }
    };
    void load();
    const onSettings = () => { void load(); };
    window.addEventListener("viggle:settings", onSettings);
    return () => {
      active = false;
      window.removeEventListener("viggle:settings", onSettings);
    };
  }, [mode]);

  return steps;
}

export function elapsedLabel(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
