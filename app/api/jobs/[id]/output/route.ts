import { NextResponse } from "next/server";
import { fileForJob, proxyComfyFile } from "../../../../../lib/proxy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await fileForJob(id, "output");
  if (!result.file) return NextResponse.json({ error: result.error }, { status: result.status });
  return proxyComfyFile(request, result.file);
}
