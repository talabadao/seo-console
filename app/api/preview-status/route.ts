import { NextResponse } from "next/server";
import { databaseUrlFor, deploymentOf, externalWritesAllowed, schedulesAllowed } from "@/lib/environment";
import { describeTarget } from "@/lib/migrations";

/**
 * Preview deployments only: shows which database the preview is connected to
 * (host and database name, never credentials) and which safeguards are on,
 * so isolation can be verified without reading secrets. Not found elsewhere.
 */
export async function GET() {
  if (deploymentOf() !== "preview") return NextResponse.json({ error: "not found" }, { status: 404 });
  let database: string | null = null;
  let databaseError: string | null = null;
  try {
    database = describeTarget(databaseUrlFor());
  } catch (e) {
    databaseError = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(
    {
      deployment: "preview",
      database,
      databaseError,
      externalWrites: externalWritesAllowed(),
      schedules: schedulesAllowed(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
