import { NextRequest, NextResponse } from "next/server";
import { SerpInputError, normalizeInput } from "@/lib/organicSerp/engines";
import { deleteConfig, listConfigs, saveConfig } from "@/lib/organicSerp/store";
import { load, type Ctx } from "../_load";

/** Saves a search configuration: { name, engine, params, depth, stopOnFound, id? } (id updates it). No search is made. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const config = await saveConfig(r.user.id, r.project.id, typeof body.name === "string" ? body.name : "", normalizeInput(body), Number(body.id) || null);
    return NextResponse.json({ config, configs: await listConfigs(r.user.id, r.project.id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof SerpInputError ? 400 : 404 });
  }
}

/** Deletes a saved configuration (?config=<id>). Its snapshots stay in the history. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const r = await load(ctx);
  if ("error" in r) return r.error;
  const id = Number(req.nextUrl.searchParams.get("config"));
  if (!Number.isSafeInteger(id) || !(await deleteConfig(r.user.id, r.project.id, id))) return NextResponse.json({ error: "unknown configuration" }, { status: 404 });
  return NextResponse.json({ configs: await listConfigs(r.user.id, r.project.id) });
}
