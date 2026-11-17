import { COMFYUI_URL } from "./config.ts";
import { COMFY_CLIENT_ID, waitForProgressSocket } from "./comfy-progress.ts";

export type ComfyOutputFile = { filename: string; subfolder: string; type: string };

export type HistoryEntry = {
  status?: {
    status_str?: string;
    completed?: boolean;
    messages?: unknown[];
  };
  outputs?: Record<string, { images?: ComfyOutputFile[]; gifs?: ComfyOutputFile[]; videos?: ComfyOutputFile[]; text?: string[] }>;
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${COMFYUI_URL}${path}`, { ...init, cache: "no-store" });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text ? `ComfyUI ${response.status}: ${text.slice(0, 400)}` : `ComfyUI ${response.status}`);
  }
  return await response.json() as T;
}

export async function queuePrompt(graph: Record<string, unknown>) {
  // ComfyUI routes progress to the submitting client id, so make sure our socket is
  // connected before the prompt can start executing.
  await waitForProgressSocket();
  const response = await fetch(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: COMFY_CLIENT_ID }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as {
    prompt_id?: string;
    error?: { message?: string; details?: string };
    node_errors?: Record<string, { errors?: Array<{ message?: string; details?: string }> }>;
  };
  if (!response.ok || !body.prompt_id) {
    const nodeError = Object.values(body.node_errors ?? {})
      .flatMap((node) => node.errors ?? [])
      .map((error) => [error.message, error.details].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
    throw new Error(body.error?.message || nodeError || `ComfyUI rejected the workflow (${response.status}).`);
  }
  return body.prompt_id;
}

export async function getHistory(id: string) {
  const all = await json<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(id)}`);
  return all[id] ?? null;
}

export async function getQueue() {
  return await json<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue");
}

export async function deleteFromQueue(promptId: string) {
  const response = await fetch(`${COMFYUI_URL}/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delete: [promptId] }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`ComfyUI could not remove the queued job (${response.status}).`);
}

export async function interruptPrompt(promptId: string) {
  const response = await fetch(`${COMFYUI_URL}/interrupt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt_id: promptId }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`ComfyUI could not interrupt the job (${response.status}).`);
}

export function queueCounts(queue: { queue_running?: unknown[][]; queue_pending?: unknown[][] }) {
  return { running: queue.queue_running?.length ?? 0, pending: queue.queue_pending?.length ?? 0 };
}

export async function getSystemStats() {
  return await json<{ system?: { comfyui_version?: string }; devices?: Array<{ name?: string; vram_total?: number; vram_free?: number }> }>("/system_stats");
}

export function viewUrl(file: ComfyOutputFile) {
  const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? "", type: file.type ?? "output" });
  return `${COMFYUI_URL}/view?${params.toString()}`;
}

export async function downloadComfyFile(file: ComfyOutputFile) {
  const response = await fetch(viewUrl(file), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ComfyUI could not serve ${file.filename} (${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export function outputFiles(entry: HistoryEntry | null) {
  if (!entry?.outputs) return [] as ComfyOutputFile[];
  return Object.values(entry.outputs).flatMap((output) => [...(output.images ?? []), ...(output.gifs ?? []), ...(output.videos ?? [])]);
}

export function messageError(entry: HistoryEntry | null) {
  const messages = entry?.status?.messages ?? [];
  for (const message of messages) {
    if (!Array.isArray(message) || message.length < 2) continue;
    const [type, data] = message as [string, unknown];
    if (type === "execution_error" && data && typeof data === "object") {
      const detail = data as { exception_message?: string; node_type?: string };
      return [detail.node_type, detail.exception_message].filter(Boolean).join(": ") || "ComfyUI stopped while running the workflow.";
    }
    if (type === "execution_interrupted") return "The job was interrupted.";
  }
  return null;
}

export async function listModels() {
  const [unets, vaes, clips, checkpoints, loras, cutout, remake, vhs, sam3, people, grow, caption, captionLoader] = await Promise.all([
    json<Record<string, { input?: { required?: { unet_name?: [string[]] } } }>>("/object_info/UNETLoader"),
    json<Record<string, { input?: { required?: { vae_name?: [string[]] } } }>>("/object_info/VAELoader"),
    json<Record<string, { input?: { required?: { clip_name?: [string[]] } } }>>("/object_info/CLIPLoader"),
    json<Record<string, { input?: { required?: { ckpt_name?: [string[]] } } }>>("/object_info/CheckpointLoaderSimple"),
    json<Record<string, { input?: { required?: { lora_name?: [string[]] } } }>>("/object_info/LoraLoaderBypassModelOnly").catch(() => null),
    json<Record<string, unknown>>(`/object_info/${encodeURIComponent("easy imageRemBg")}`).catch(() => null),
    json<Record<string, unknown>>("/object_info/RemakeConditioning").catch(() => null),
    json<Record<string, unknown>>("/object_info/VHS_LoadVideo").catch(() => null),
    json<Record<string, unknown>>("/object_info/SAM3_VideoTrack").catch(() => null),
    json<Record<string, unknown>>("/object_info/H3PeopleMask").catch(() => null),
    json<Record<string, unknown>>("/object_info/GrowMaskWithBlur").catch(() => null),
    json<Record<string, unknown>>("/object_info/Florence2Run").catch(() => null),
    json<Record<string, { input?: { required?: { model?: [string[]] } } }>>("/object_info/Florence2ModelLoader").catch(() => null),
  ]);
  return {
    unets: unets.UNETLoader?.input?.required?.unet_name?.[0] ?? [],
    vaes: vaes.VAELoader?.input?.required?.vae_name?.[0] ?? [],
    clips: clips.CLIPLoader?.input?.required?.clip_name?.[0] ?? [],
    checkpoints: checkpoints.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [],
    loras: loras?.LoraLoaderBypassModelOnly?.input?.required?.lora_name?.[0] ?? [],
    captionModels: captionLoader?.Florence2ModelLoader?.input?.required?.model?.[0] ?? [],
    hasCutoutNode: Boolean(cutout?.["easy imageRemBg"]),
    hasRemakeNode: Boolean(remake?.RemakeConditioning),
    hasVhsNode: Boolean(vhs?.VHS_LoadVideo),
    hasSam3Node: Boolean(sam3?.SAM3_VideoTrack),
    hasPeopleMaskNode: Boolean(people?.H3PeopleMask),
    hasGrowMaskNode: Boolean(grow?.GrowMaskWithBlur),
    hasCaptionNode: Boolean(caption?.Florence2Run),
  };
}
