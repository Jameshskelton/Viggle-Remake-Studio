import { NextResponse } from "next/server";
import { getJob, saveJob } from "../../../../../lib/jobs.ts";
import { deleteFromQueue, interruptPrompt } from "../../../../../lib/comfy.ts";
import { clearProgress } from "../../../../../lib/comfy-progress.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
    return NextResponse.json({ error: "This job is already finished." }, { status: 409 });
  }

  try {
    // One call removes a pending item; the other interrupts it if it is already running.
    await Promise.all([deleteFromQueue(id), interruptPrompt(id)]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to cancel the job." },
      { status: 502 },
    );
  }

  job.status = "cancelled";
  job.error = "Cancelled by the user.";
  job.finishedAt = Date.now();
  await saveJob(job);
  clearProgress(id);
  return NextResponse.json({ id, status: "cancelled" });
}
