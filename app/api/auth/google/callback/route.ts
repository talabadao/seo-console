import { NextRequest, NextResponse } from "next/server";
import { oauthClient } from "@/lib/google/oauth";
import { currentUser, getSession } from "@/lib/session";
import { connectionEligibility, type GoogleClaims } from "@/lib/auth/eligibility";
import { audit, linkIdentity, signInWithGoogle } from "@/lib/auth/identities";
import { saveGrant } from "@/lib/google/connections";
import { refreshConnection } from "@/lib/google/discovery";

const STATE_TTL_MS = 10 * 60_000;

/**
 * The one OAuth callback (one registered redirect URI) for three purposes, decided by what this session started
 * (app/api/auth/google): personal sign-in, linking another login to the signed-in User, or connecting a shared
 * Google data source. The ID token is verified with Google's library (signature, issuer, audience, expiry), then the
 * nonce, then eligibility on the verified claims. A data connection never changes the personal session. Failures
 * redirect with a fixed code (lib/auth/messages.ts), never free text.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const fail = (path: string, code: string) => NextResponse.redirect(`${origin}${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(code)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const session = await getSession();
  const pending = session.oauth;
  // Whatever happens next, this round trip can't be completed twice.
  session.oauth = undefined;
  await session.save();

  if (!pending || !state || state !== pending.state || Date.now() - pending.createdAt > STATE_TTL_MS) return fail("/", "expired");
  const back = pending.purpose === "login" ? "/" : pending.purpose === "link" ? "/account/logins" : "/account/connections";
  if (url.searchParams.get("error")) return fail(back, url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  if (!code) return fail(back, "failed");

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return fail(back, "bad-token");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const claims = ticket.getPayload() as (GoogleClaims & { nonce?: string }) | undefined;
    if (!claims || claims.nonce !== pending.nonce) return fail(back, "bad-token");

    if (pending.purpose === "login") {
      const r = await signInWithGoogle(claims);
      if (!r.ok) return fail("/", r.reason);
      const fresh = await getSession();
      fresh.userId = r.userId;
      fresh.identityId = r.identityId;
      fresh.email = undefined;
      await fresh.save();
      return NextResponse.redirect(`${origin}${pending.returnTo ?? "/"}`);
    }

    // Link and connect: the User who started the flow must still be the one signed in.
    const user = await currentUser();
    if (!user || user.id !== pending.userId) return fail("/", "session-changed");

    if (pending.purpose === "link") {
      const r = await linkIdentity(user.id, claims);
      if (!r.ok) return fail("/account/logins", r.reason === "conflict" ? "link-conflict" : r.reason);
      if (r.status === "merge-required") return NextResponse.redirect(`${origin}/account/logins?merge=${r.mergeRequestId}`);
      return NextResponse.redirect(`${origin}/account/logins?linked=1`);
    }

    // connect-google: a workspace data source; the personal session stays exactly as it was.
    const elig = connectionEligibility(claims);
    if (!elig.ok) return fail("/account/connections", elig.reason === "not-eligible" ? "connect-not-eligible" : elig.reason);
    const saved = await saveGrant({ workspaceId: user.workspace_id!, identity: elig.identity, tokens, grantedBy: user.id });
    await audit("connect-google", { userId: user.id, email: elig.identity.email, detail: { connectionId: saved.id, created: saved.created } });
    // List what it can read right away (a failure here leaves the connection saved; Refresh retries).
    await refreshConnection(saved.id).catch(() => null);
    return NextResponse.redirect(`${origin}/account/connections?connected=${saved.id}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    console.error("oauth callback failed", pending.purpose, message.slice(0, 200));
    return fail(back, /refresh token/i.test(message) ? "no-refresh-token" : "failed");
  }
}
