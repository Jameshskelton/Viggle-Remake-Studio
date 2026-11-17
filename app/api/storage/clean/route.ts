import { NextResponse } from "next/server";
import { cleanStorage } from "../../../../lib/storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      keepAssetIds?: unknown;
      clipMaxAgeDays?: unknown;
      cleanComfy?: unknown;
    };
    const keepAssetIds = Array.isArray(body.keepAssetIds)
      ? body.keepAssetIds.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id))
      : [];
    const clipMaxAgeDays = Math.min(365, Math.max(1, Math.round(Number(body.clipMaxAgeDays ?? 7)) || 7));
    const cleanComfy = body.cleanComfy === true;
    const result = await cleanStorage({ keepAssetIds, clipMaxAgeDays, cleanComfy });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to clean storage." },
      { status: 500 },
    );
  }
}
