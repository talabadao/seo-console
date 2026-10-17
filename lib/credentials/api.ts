// Guards for the account-credential API routes: a signed-in (allowlisted) account, the credentials table
// present (migration 0005) and, for writes, the encryption key configured. Ownership is always the session's
// user id; nothing in a request body can choose the account.

import { NextResponse } from "next/server";
import { currentUser, type UserRow } from "@/lib/session";
import { storageConfigured } from "./crypto";
import { credentialsReady } from "./store";

export async function credentialGuard(opts: { write: boolean }): Promise<{ user: UserRow } | { error: NextResponse }> {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (!(await credentialsReady())) {
    return { error: NextResponse.json({ error: "This database hasn't run migration 0005 (account credentials) yet.", state: "unavailable" }, { status: 503 }) };
  }
  if (opts.write && !storageConfigured()) {
    return {
      error: NextResponse.json(
        { error: "Credential storage isn't configured on this server (CREDENTIALS_ENCRYPTION_KEY). Nothing was saved.", state: "storage-unavailable" },
        { status: 503 },
      ),
    };
  }
  return { user };
}
