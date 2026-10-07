import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { GoogleReauthRequiredError, accessTokenFor, hasBusinessScope } from "@/lib/google/oauth";
import { BusinessProfileError, listLocations } from "@/lib/google/businessProfile";

/** Business Profile locations the signed-in Google account manages (for the project form). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasBusinessScope(user.google_scopes)) {
    return NextResponse.json({ locations: [], needsReconnect: true });
  }
  try {
    const token = await accessTokenFor(user);
    return NextResponse.json({ locations: await listLocations(token) });
  } catch (e) {
    if (e instanceof GoogleReauthRequiredError) {
      return NextResponse.json({ locations: [], needsReconnect: true });
    }
    if (e instanceof BusinessProfileError) {
      return NextResponse.json({ locations: [], error: e.message, enableUrl: e.enableUrl });
    }
    return NextResponse.json({ locations: [], error: e instanceof Error ? e.message : String(e) });
  }
}
