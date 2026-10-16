import type { Migration } from "../../lib/migrations";

/**
 * Account API credentials (SerpApi, OpenAI, Anthropic, DataForSEO), owned by the signed-in account and shared
 * across that account's projects. The provider's fields are stored as one AES-256-GCM ciphertext
 * (lib/credentials/crypto.ts) with the id of the key that encrypted it; never in plain text.
 * - hint: a masked identifier for display (last 4 characters of the secret, or a masked DataForSEO login).
 * - fingerprint: SHA-256 prefix of the secret, to compare credentials (e.g. legacy project keys) without
 *   decrypting or revealing them.
 * - verify_*: the last non-billable connection check, kept separate from "saved". Cleared when the credential
 *   changes, so a new value always starts as Untested.
 */
export const migration: Migration = {
  id: "0005_account_credentials",
  description: "Encrypted account API credentials",
  statements: [
    `CREATE TABLE IF NOT EXISTS account_credentials (
       user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       provider        TEXT NOT NULL,
       ciphertext      TEXT NOT NULL,
       key_id          TEXT NOT NULL,
       hint            TEXT,
       fingerprint     TEXT NOT NULL,
       updated_at      BIGINT NOT NULL,
       verified_at     BIGINT,
       verify_status   TEXT,
       verify_message  TEXT,
       PRIMARY KEY (user_id, provider)
     )`,
  ],
};
