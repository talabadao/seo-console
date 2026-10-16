// Account API credentials (table account_credentials, migration 0005). Every function takes the authenticated
// user's internal id — never an id or email from a request body — so one account can't read, replace or remove
// another's credentials. Secrets are only decrypted for server-side calls (readCredential) and never returned
// to the browser: the status functions return a masked hint, timestamps and the last check result only.

import { createHash } from "node:crypto";
import { db, tableExists } from "@/lib/db";
import { decryptFor, encryptFor, keyring } from "./crypto";
import { providerSpec, type CredentialProvider, type CredentialStatus } from "./providers";

export class CredentialInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialInputError";
  }
}

/**
 * A blank value, or one containing mask characters (•, ·) or made only of asterisks, is a placeholder — e.g. the
 * masked "••••5678" shown for a saved key — never a value to save. Real provider keys never contain them.
 */
export function isPlaceholder(value: string): boolean {
  return value.trim().length === 0 || /[•·]/.test(value) || /^[\s*]+$/.test(value);
}

export const fingerprintOf = (secret: string) => createHash("sha256").update(secret).digest("hex").slice(0, 16);

/** The field that identifies the credential (its main secret). */
function mainSecret(provider: CredentialProvider, values: Record<string, string>): string {
  return provider === "dataforseo" ? `${values.login}:${values.password}` : values.apiKey;
}

function hintFor(provider: CredentialProvider, values: Record<string, string>): string {
  if (provider === "dataforseo") {
    const login = values.login;
    const [name, domain] = login.split("@");
    return domain ? `${name.slice(0, 2)}•••@${domain}` : `${login.slice(0, 2)}•••`;
  }
  return values.apiKey.slice(-4);
}

export async function credentialsReady(): Promise<boolean> {
  return tableExists("account_credentials");
}

/** Validates and normalises a provider's input. Throws CredentialInputError with a message for the form. */
export function cleanValues(provider: string, input: unknown): { provider: CredentialProvider; values: Record<string, string> } {
  const spec = providerSpec(provider);
  if (!spec) throw new CredentialInputError("Unknown provider.");
  const raw = (input ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const f of spec.fields) {
    const v = typeof raw[f.name] === "string" ? (raw[f.name] as string).trim() : "";
    if (isPlaceholder(v)) throw new CredentialInputError(`Enter the ${spec.label} ${f.label.toLowerCase()}. Leaving the form unchanged keeps the saved credential.`);
    if (v.length > 500 || /\s/.test(v)) throw new CredentialInputError(`That ${f.label.toLowerCase()} doesn't look valid (no spaces, at most 500 characters).`);
    values[f.name] = v;
  }
  return { provider: spec.id, values };
}

/**
 * Saves (or replaces) the account's credential for a provider. The row is written only after encryption
 * succeeds; a new value always starts Untested. Returns the new status.
 */
export async function saveCredential(userId: number, provider: CredentialProvider, values: Record<string, string>): Promise<CredentialStatus> {
  const { ciphertext, keyId } = encryptFor(userId, provider, JSON.stringify(values));
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO account_credentials (user_id, provider, ciphertext, key_id, hint, fingerprint, updated_at, verified_at, verify_status, verify_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
       ON CONFLICT (user_id, provider) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, key_id = EXCLUDED.key_id, hint = EXCLUDED.hint,
         fingerprint = EXCLUDED.fingerprint, updated_at = EXCLUDED.updated_at, verified_at = NULL, verify_status = NULL, verify_message = NULL`,
    )
    .run(userId, provider, ciphertext, keyId, hintFor(provider, values), fingerprintOf(mainSecret(provider, values)), now);
  return (await credentialStatuses(userId)).find((s) => s.provider === provider)!;
}

/** Removes the account's credential for a provider (explicit action). Returns whether one was removed. */
export async function removeCredential(userId: number, provider: CredentialProvider): Promise<boolean> {
  const res = await db.prepare("DELETE FROM account_credentials WHERE user_id = ? AND provider = ?").run(userId, provider);
  return res.count > 0;
}

interface Row {
  provider: string;
  ciphertext: string;
  key_id: string;
  hint: string | null;
  fingerprint: string;
  updated_at: number;
  verified_at: number | null;
  verify_status: string | null;
  verify_message: string | null;
}

/** Saved state of every provider for an account (missing providers come back as not saved). */
export async function credentialStatuses(userId: number): Promise<CredentialStatus[]> {
  const rows = (await credentialsReady())
    ? ((await db
        .prepare("SELECT provider, hint, updated_at, verified_at, verify_status, verify_message FROM account_credentials WHERE user_id = ?")
        .all(userId)) as unknown as Row[])
    : [];
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return (["serpapi", "openai", "anthropic", "dataforseo"] as const).map((provider) => {
    const r = byProvider.get(provider);
    return {
      provider,
      saved: Boolean(r),
      hint: r?.hint ?? null,
      updatedAt: r ? Number(r.updated_at) : null,
      verifyStatus: r?.verify_status === "ok" || r?.verify_status === "failed" ? r.verify_status : null,
      verifiedAt: r?.verified_at == null ? null : Number(r.verified_at),
      verifyMessage: r?.verify_message ?? null,
      source: r ? "account" : null,
    };
  });
}

/** The decrypted fields of an account's credential, for server-side provider calls only. */
export async function readCredential(userId: number, provider: CredentialProvider): Promise<{ values: Record<string, string>; fingerprint: string } | null> {
  if (!(await credentialsReady())) return null;
  const r = (await db.prepare("SELECT ciphertext, key_id, fingerprint FROM account_credentials WHERE user_id = ? AND provider = ?").get(userId, provider)) as
    | Pick<Row, "ciphertext" | "key_id" | "fingerprint">
    | undefined;
  if (!r) return null;
  return { values: JSON.parse(decryptFor(userId, provider, r.ciphertext, r.key_id)) as Record<string, string>, fingerprint: r.fingerprint };
}

/** The account credential's fingerprint (no decryption), or null. */
export async function credentialFingerprint(userId: number, provider: CredentialProvider): Promise<string | null> {
  if (!(await credentialsReady())) return null;
  const r = (await db.prepare("SELECT fingerprint FROM account_credentials WHERE user_id = ? AND provider = ?").get(userId, provider)) as { fingerprint: string } | undefined;
  return r?.fingerprint ?? null;
}

/**
 * Records a connection check. Only applies if the credential is still the one that was checked (same
 * fingerprint), so a check that finishes after a replacement can't mark the new credential verified.
 */
export async function recordVerification(userId: number, provider: CredentialProvider, fingerprint: string, ok: boolean, message: string): Promise<void> {
  await db
    .prepare(
      "UPDATE account_credentials SET verified_at = ?, verify_status = ?, verify_message = ? WHERE user_id = ? AND provider = ? AND fingerprint = ?",
    )
    .run(Date.now(), ok ? "ok" : "failed", message.slice(0, 300), userId, provider, fingerprint);
}

/** Re-encrypts every row with the current key (after a key rotation; see crypto.ts). Returns rows rewritten. */
export async function reencryptAll(): Promise<number> {
  const ring = keyring();
  const rows = (await db.prepare("SELECT user_id, provider, ciphertext, key_id FROM account_credentials WHERE key_id <> ?").all(ring.currentId)) as unknown as {
    user_id: number;
    provider: string;
    ciphertext: string;
    key_id: string;
  }[];
  for (const r of rows) {
    const plain = decryptFor(Number(r.user_id), r.provider, r.ciphertext, r.key_id);
    const next = encryptFor(Number(r.user_id), r.provider, plain);
    await db
      .prepare("UPDATE account_credentials SET ciphertext = ?, key_id = ? WHERE user_id = ? AND provider = ? AND key_id = ?")
      .run(next.ciphertext, next.keyId, r.user_id, r.provider, r.key_id);
  }
  return rows.length;
}
