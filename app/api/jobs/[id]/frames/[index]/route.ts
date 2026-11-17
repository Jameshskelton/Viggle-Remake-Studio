import { NextResponse } from "next/server";
import { fileForJob, proxyComfyFile } from "../../../../../../lib/proxy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const which = new URL(request.url).searchParams.get("type") === "mask" ? "mask" : "frame";
  const number = Number(index);
  if (!Number.isInteger(number) || number < 0) return NextResponse.json({ error: "Invalid frame index." }, { status: 400 });
  const result = await fileForJob(id, which, number);
  if (!result.file) return NextResponse.json({ error: result.error }, { status: result.status });
  return proxyComfyFile(request, result.file);
}
