import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authUrl } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";

export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: "Google OAuth not configured. Copy .env.local.example to .env.local and fill it in." },
      { status: 500 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const session = await getSession();
  session.oauthState = state;
  await session.save();
  return NextResponse.redirect(authUrl(state));
}
