import { messageError, type HistoryEntry } from "./comfy.ts";
import type { JobStatus } from "./types.ts";

export type JobStatusInput = {
  storedStatus: JobStatus;
  createdAt: number;
  entry: HistoryEntry | null;
  running: boolean;
  pendingIndex: number;
  historyError: boolean;
  queueError: boolean;
  now: number;
};

export type JobStatusResult =
  | { kind: "retry"; error: string }
  | { kind: "status"; status: JobStatus; error: string | null; queuePosition: number | null };

const STALE_AFTER_MS = 30_000;

export function resolveJobStatus(input: JobStatusInput): JobStatusResult {
  if (input.historyError && input.queueError) {
    return { kind: "retry", error: "ComfyUI is not reachable." };
  }
  if (input.historyError && !input.running && input.pendingIndex < 0) {
    return { kind: "retry", error: "ComfyUI history is temporarily unavailable. Retrying." };
  }
  if (input.entry?.status?.completed) {
    if (input.entry.status.status_str === "error") {
      return {
        kind: "status",
        status: "failed",
        error: messageError(input.entry) ?? "ComfyUI could not run this workflow.",
        queuePosition: null,
      };
    }
    return { kind: "status", status: "succeeded", error: null, queuePosition: null };
  }
  if (input.entry?.status?.status_str === "error") {
    return {
      kind: "status",
      status: "failed",
      error: messageError(input.entry) ?? "ComfyUI could not run this workflow.",
      queuePosition: null,
    };
  }
  if (input.running) {
    return { kind: "status", status: "running", error: null, queuePosition: null };
  }
  if (input.pendingIndex >= 0) {
    return { kind: "status", status: "queued", error: null, queuePosition: input.pendingIndex + 1 };
  }
  if (!input.entry) {
    if (input.queueError) {
      return { kind: "status", status: input.storedStatus, error: null, queuePosition: null };
    }
    const stale = input.now - input.createdAt > STALE_AFTER_MS;
    return {
      kind: "status",
      status: stale ? "failed" : "queued",
      error: stale ? "ComfyUI no longer has this job (it may have restarted)." : null,
      queuePosition: null,
    };
  }
  return { kind: "status", status: input.storedStatus, error: null, queuePosition: null };
}
