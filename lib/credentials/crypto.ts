// Encryption at rest for account API credentials: AES-256-GCM (authenticated encryption) with a server-managed
// key that is NOT the session secret.
//
// Keys (server environment only):
// - CREDENTIALS_ENCRYPTION_KEY       base64 of 32 random bytes — the current key.
// - CREDENTIALS_ENCRYPTION_KEY_ID    short id of the current key (default "1"); stored with every ciphertext.
// - CREDENTIALS_ENCRYPTION_KEYS_OLD  optional "id:base64,id:base64" — earlier keys, used only to decrypt.
//
// Rotation: add the current key to CREDENTIALS_ENCRYPTION_KEYS_OLD under its id, set a new
// CREDENTIALS_ENCRYPTION_KEY with a new CREDENTIALS_ENCRYPTION_KEY_ID, redeploy, then run
// `reencryptAll` (lib/credentials/store.ts) so every row moves to the new key; finally drop the old key.
// Never replace the current key without keeping it as an old key first: rows encrypted with it would become
// unreadable.
//
// Every ciphertext is bound to its owner and provider through the GCM additional data ("<userId>:<provider>"),
// so a ciphertext copied to another account or provider fails to decrypt instead of leaking.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

export class CredentialStorageUnavailable extends Error {
  constructor(detail: string) {
    super(`Credential storage isn't configured on this server: ${detail}`);
    this.name = "CredentialStorageUnavailable";
  }
}

interface Keyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

function parseKey(b64: string, label: string): Buffer {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new CredentialStorageUnavailable(`${label} must be 32 bytes, base64-encoded.`);
  return key;
}

export function keyring(env: Env = process.env): Keyring {
  const current = env.CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!current) throw new CredentialStorageUnavailable("CREDENTIALS_ENCRYPTION_KEY is missing.");
  const currentId = (env.CREDENTIALS_ENCRYPTION_KEY_ID?.trim() || "1").replace(/[^\w-]/g, "");
  const keys = new Map<string, Buffer>();
  for (const part of (env.CREDENTIALS_ENCRYPTION_KEYS_OLD ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    keys.set(part.slice(0, at), parseKey(part.slice(at + 1), `old key ${part.slice(0, at)}`));
  }
  keys.set(currentId, parseKey(current, "CREDENTIALS_ENCRYPTION_KEY"));
  return { currentId, keys };
}

export function storageConfigured(env: Env = process.env): boolean {
  try {
    keyring(env);
    return true;
  } catch {
    return false;
  }
}

const aad = (userId: number, provider: string) => Buffer.from(`${userId}:${provider}`, "utf8");

/** Encrypts a provider's fields for one account. Returns the ciphertext ("<iv>.<tag>.<data>", base64) and key id. */
export function encryptFor(userId: number, provider: string, plaintext: string, env: Env = process.env): { ciphertext: string; keyId: string } {
  const ring = keyring(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.keys.get(ring.currentId)!, iv);
  cipher.setAAD(aad(userId, provider));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: [iv, tag, data].map((b) => b.toString("base64")).join("."), keyId: ring.currentId };
}

/**
 * Encrypts a secret bound to an arbitrary context string (GCM additional data), e.g. "google-connection:7:refresh".
 * Used for workspace data connections, whose secrets belong to a connection rather than a person.
 */
export function encryptWithContext(context: string, plaintext: string, env: Env = process.env): { ciphertext: string; keyId: string } {
  const ring = keyring(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.keys.get(ring.currentId)!, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join("."), keyId: ring.currentId };
}

export function decryptWithContext(context: string, ciphertext: string, keyId: string, env: Env = process.env): string {
  const key = keyring(env).keys.get(keyId);
  if (!key) throw new CredentialStorageUnavailable(`no key with id "${keyId}" (needed to read a saved connection).`);
  const [iv, tag, data] = ciphertext.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Malformed stored secret.");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** A ciphertext and its key id in one column ("<keyId>$<ciphertext>"), for short-lived secrets such as access tokens. */
export const packSecret = (s: { ciphertext: string; keyId: string }) => `${s.keyId}$${s.ciphertext}`;
export function unpackSecret(packed: string): { ciphertext: string; keyId: string } | null {
  const at = packed.indexOf("$");
  return at > 0 ? { keyId: packed.slice(0, at), ciphertext: packed.slice(at + 1) } : null;
}

/** Decrypts a stored ciphertext. Throws if the key id is unknown or the data was altered or moved. */
export function decryptFor(userId: number, provider: string, ciphertext: string, keyId: string, env: Env = process.env): string {
  const ring = keyring(env);
  const key = ring.keys.get(keyId);
  if (!key) throw new CredentialStorageUnavailable(`no key with id "${keyId}" (needed to read a saved credential).`);
  const [iv, tag, data] = ciphertext.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Malformed stored credential.");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad(userId, provider));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
