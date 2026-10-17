import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authUrl, type OAuthPurpose } from "@/lib/google/oauth";
import { currentUser, getSession } from "@/lib/session";

const PURPOSES: OAuthPurpose[] = ["login", "link", "connect-google"];

/**
 * Starts a Google OAuth round trip for one purpose (?purpose=login | link | connect-google). The state and nonce are
 * stored in this session with the purpose (and, for link/connect, the signed-in User), so the callback can only
 * complete the flow this session started: a data connection never replaces the personal session, and a link can't
 * be finished by someone else.
 */
export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: "Google OAuth not configured. Copy .env.local.example to .env.local and fill it in." }, { status: 500 });
  }
  const raw = req.nextUrl.searchParams.get("purpose") ?? "login";
  const purpose = (PURPOSES as string[]).includes(raw) ? (raw as OAuthPurpose) : "login";
  const origin = req.nextUrl.origin;
  let userId: number | undefined;
  if (purpose !== "login") {
    const user = await currentUser();
    if (!user) return NextResponse.redirect(`${origin}/?error=${encodeURIComponent("Sign in first.")}`);
    userId = user.id;
  }
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const returnTo = req.nextUrl.searchParams.get("returnTo");
  const session = await getSession();
  session.oauth = { state, nonce, purpose, userId, createdAt: Date.now(), ...(returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? { returnTo } : {}) };
  session.oauthState = undefined;
  await session.save();
  return NextResponse.redirect(authUrl(state, purpose, nonce));
}
