import { NextRequest, NextResponse } from "next/server";
import { oauthClient } from "@/lib/google/oauth";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const origin = url.origin;

  if (err) return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(err)}`);
  if (!code) return NextResponse.redirect(`${origin}/?error=missing_code`);

  const session = await getSession();
  if (!state || state !== session.oauthState) {
    return NextResponse.redirect(`${origin}/?error=state_mismatch`);
  }

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const info = await client.request<{ email: string; name?: string; picture?: string }>({
      url: "https://www.googleapis.com/oauth2/v3/userinfo",
    });
    const { email, name, picture } = info.data;
    if (!email) return NextResponse.redirect(`${origin}/?error=no_email`);

    const now = Date.now();
    const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      | { id: number; google_refresh_token: string | null }
      | undefined;

    // Keep an existing refresh token if Google didn't return a new one.
    const refresh = tokens.refresh_token ?? existing?.google_refresh_token ?? null;

    const scope = tokens.scope ?? null;

    let userId: number;
    if (existing) {
      db.prepare(
        `UPDATE users SET name = ?, picture = ?, google_access_token = ?,
           google_refresh_token = ?, google_token_expiry = ?, google_scopes = ?, updated_at = ? WHERE id = ?`,
      ).run(
        name ?? null,
        picture ?? null,
        tokens.access_token ?? null,
        refresh,
        tokens.expiry_date ?? now + 3500_000,
        scope,
        now,
        existing.id,
      );
      userId = existing.id;
    } else {
      userId = (
        db
          .prepare(
            `INSERT INTO users (email, name, picture, google_access_token, google_refresh_token,
               google_token_expiry, google_scopes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          )
          .get(
            email,
            name ?? null,
            picture ?? null,
            tokens.access_token ?? null,
            refresh,
            tokens.expiry_date ?? now + 3500_000,
            scope,
            now,
            now,
          ) as { id: number }
      ).id;
    }

    session.userId = userId;
    session.email = email;
    session.oauthState = undefined;
    await session.save();

    return NextResponse.redirect(`${origin}/`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "oauth_failed";
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(message)}`);
  }
}
