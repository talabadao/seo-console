import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { aiDomainsFor, saveAiDomains } from "@/lib/gaConfig";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ aiDomains: aiDomainsFor(user) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { aiDomains?: string[] };
  if (!Array.isArray(body.aiDomains)) {
    return NextResponse.json({ error: "aiDomains array required" }, { status: 400 });
  }
  saveAiDomains(user.id, body.aiDomains);
  return NextResponse.json({ aiDomains: aiDomainsFor({ ga_ai_domains: JSON.stringify(body.aiDomains) }) });
}
