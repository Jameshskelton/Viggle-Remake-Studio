import { COMFYUI_URL } from "./config.ts";

// One ComfyUI WebSocket for the whole app. Prompts are submitted with this client id,
// so ComfyUI routes execution/progress messages for our jobs to this socket.
export const COMFY_CLIENT_ID = "viggle-studio";

export type ComfyProgress = {
  value: number;
  max: number;
  node?: string;
  startedAt: number;
  firstAt?: number;
  updatedAt: number;
};

type Tracker = {
  socket?: WebSocket;
  starts: Map<string, number>;
  progress: Map<string, ComfyProgress>;
};

const trackerGlobal = globalThis as typeof globalThis & { __viggleComfyTracker?: Tracker };
const tracker: Tracker = (trackerGlobal.__viggleComfyTracker ??= { starts: new Map(), progress: new Map() });

function socketUrl() {
  return `${COMFYUI_URL.replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(COMFY_CLIENT_ID)}`;
}

function connect() {
  const current = tracker.socket;
  if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) return;
  try {
    const socket = new WebSocket(socketUrl());
    tracker.socket = socket;

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message: { type?: string; data?: Record<string, unknown> };
      try {
        message = JSON.parse(event.data) as typeof message;
      } catch {
        return;
      }
      const data = message.data ?? {};
      const promptId = typeof data.prompt_id === "string" ? data.prompt_id : undefined;
      if (!promptId) return;
      const now = Date.now();

      if (message.type === "execution_start") {
        tracker.starts.set(promptId, now);
        return;
      }
      if (message.type === "progress") {
        const value = Number(data.value ?? 0);
        const max = Number(data.max ?? 0);
        if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return;
        const node = typeof data.node === "string" ? data.node : "";
        const key = `${promptId}:${node}`;
        const previous = tracker.progress.get(key);
        const startedAt = tracker.starts.get(promptId) ?? previous?.startedAt ?? now;
        tracker.progress.set(key, {
          value,
          max,
          node,
          startedAt,
          firstAt: previous?.firstAt ?? (value > 0 ? now : undefined),
          updatedAt: now,
        });
        return;
      }
      if (message.type === "execution_success" || message.type === "execution_error" || message.type === "execution_interrupted") {
        clearProgress(promptId);
      }
    });

    const forget = () => {
      if (tracker.socket === socket) tracker.socket = undefined;
    };
    socket.addEventListener("close", forget);
    socket.addEventListener("error", () => {
      try { socket.close(); } catch { /* ignore */ }
      forget();
    });
  } catch {
    tracker.socket = undefined;
  }
}

export function ensureProgressSocket() {
  connect();
}

export async function waitForProgressSocket(timeoutMs = 1500) {
  connect();
  const socket = tracker.socket;
  if (!socket || socket.readyState === WebSocket.OPEN) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", finish);
      socket.removeEventListener("error", finish);
      socket.removeEventListener("close", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.addEventListener("open", finish, { once: true });
    socket.addEventListener("error", finish, { once: true });
    socket.addEventListener("close", finish, { once: true });
  });
}

export function progressFor(promptId: string | undefined, node?: string) {
  if (!promptId) return undefined;
  let entry: ComfyProgress | undefined;
  if (node) {
    entry = tracker.progress.get(`${promptId}:${node}`);
  } else {
    // No node pinned: use whichever phase reported most recently.
    for (const [key, value] of tracker.progress) {
      if (!key.startsWith(`${promptId}:`)) continue;
      if (!entry || value.updatedAt > entry.updatedAt) entry = value;
    }
  }
  if (!entry) return undefined;
  return {
    value: entry.value,
    max: entry.max,
    startedAt: entry.startedAt,
    firstAt: entry.firstAt,
  };
}

export function clearProgress(promptId: string) {
  tracker.starts.delete(promptId);
  for (const key of tracker.progress.keys()) {
    if (key.startsWith(`${promptId}:`)) tracker.progress.delete(key);
  }
}
