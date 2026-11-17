import { NextResponse } from "next/server";
import { purgeAppData, PurgeBlockedError } from "../../../../lib/storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      confirm?: unknown;
      cleanComfy?: unknown;
      resetSettings?: unknown;
    };
    if (body.confirm !== "DELETE") {
      return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
    }
    const result = await purgeAppData({
      cleanComfy: body.cleanComfy === true,
      resetSettings: body.resetSettings === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PurgeBlockedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to delete the app data." },
      { status: 500 },
    );
  }
}
