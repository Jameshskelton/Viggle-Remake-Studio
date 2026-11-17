import { NextResponse } from "next/server";
import path from "node:path";
import { getJob } from "./jobs.ts";
import { viewUrl } from "./comfy.ts";
import type { ComfyOutputFile } from "./comfy.ts";

const TYPES: Record<string, string> = {
  mp4: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", mov: "video/quicktime",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};

export async function proxyComfyFile(request: Request, file: ComfyOutputFile) {
  const headers: Record<string, string> = {};
  const range = request.headers.get("Range");
  if (range) headers.Range = range;
  const upstream = await fetch(viewUrl(file), { headers, cache: "no-store" });
  if (!upstream.ok) {
    return NextResponse.json({ error: "ComfyUI could not serve that file." }, { status: 502 });
  }
  const ext = path.extname(file.filename).replace(/^\./, "").toLowerCase();
  const type = upstream.headers.get("Content-Type")?.split(";")[0] || TYPES[ext] || "application/octet-stream";
  const out = new Headers({
    "Content-Type": type,
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  for (const header of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
    const value = upstream.headers.get(header);
    if (value) out.set(header, value);
  }
  if (new URL(request.url).searchParams.has("download")) {
    out.set("Content-Disposition", `attachment; filename="${path.basename(file.filename).replace(/"/g, "")}"`);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export async function fileForJob(id: string, which: "preview" | "output" | "frame" | "mask", index = 0) {
  const job = await getJob(id);
  if (!job) return { error: "Job not found.", status: 404 as const, file: null };
  const file = which === "preview" ? job.preview
    : which === "output" ? job.output
    : which === "frame" ? job.frameFiles?.[index]
    : job.maskFiles?.[index];
  if (!file) return { error: "That file is not ready.", status: 404 as const, file: null };
  return { file, status: 200 as const, error: null };
}
