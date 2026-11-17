import { NextResponse } from "next/server";
import { storageStats } from "../../../lib/storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await storageStats());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read storage usage." },
      { status: 500 },
    );
  }
}
