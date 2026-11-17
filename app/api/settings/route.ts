import { NextResponse } from "next/server";
import { listModels } from "../../../lib/comfy.ts";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../../../lib/settings.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const settings = await loadSettings();
  const includeModels = new URL(request.url).searchParams.get("models") !== "0";
  let models = null;
  let modelsError: string | null = null;
  if (includeModels) {
    try {
      models = await listModels();
    } catch (error) {
      modelsError = error instanceof Error ? error.message : "ComfyUI is not reachable.";
    }
  }
  return NextResponse.json({ settings, defaults: DEFAULT_SETTINGS, models, modelsError });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid settings." }, { status: 400 });
    }
    const settings = await saveSettings(body as Record<string, unknown>);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save the settings." },
      { status: 400 },
    );
  }
}
