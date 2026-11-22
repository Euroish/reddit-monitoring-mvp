import type { Pool } from "pg";
import { createPool, transaction } from "../../storage/db";
import { decryptCredentialSecret, deriveCredentialKey, encryptCredentialSecret } from "./credentials";

export async function rotateCredentialKey(pool: Pool, activeKey: Buffer, nextKey: Buffer, apply: boolean) {
  if (activeKey.equals(nextKey)) throw new Error("The next credential key must be different");
  return transaction(pool, async (client) => {
    if (apply) await client.query("LOCK TABLE source_provider_credential IN ACCESS EXCLUSIVE MODE");
    const rows = await client.query<{ provider: string; encrypted_secret: string }>(
      "SELECT provider,encrypted_secret FROM source_provider_credential ORDER BY provider",
    );
    for (const row of rows.rows) {
      const plaintext = decryptCredentialSecret(row.encrypted_secret, activeKey);
      const rotated = encryptCredentialSecret(plaintext, nextKey);
      if (decryptCredentialSecret(rotated, nextKey) !== plaintext) throw new Error("Credential verification failed");
      if (apply) {
        await client.query(
          "UPDATE source_provider_credential SET encrypted_secret=$2,revision=revision+1,updated_at=NOW() WHERE provider=$1",
          [row.provider, rotated],
        );
      }
    }
    return rows.rows.length;
  });
}

async function main() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== "--check" && mode !== "--apply"))
    throw new Error("Select --check or --apply");
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  const nextMaster = process.env.NEXT_CREDENTIALS_MASTER_KEY?.trim() ?? "";
  if (nextMaster.length < 32 || nextMaster === sessionSecret)
    throw new Error("NEXT_CREDENTIALS_MASTER_KEY must be independent and at least 32 characters");
  const activeKey = deriveCredentialKey(sessionSecret);
  const nextKey = deriveCredentialKey(sessionSecret, { CREDENTIALS_MASTER_KEY: nextMaster });
  const pool = createPool(undefined, 1);
  try {
    const rows = await rotateCredentialKey(pool, activeKey, nextKey, mode === "--apply");
    console.log(JSON.stringify({ operation: mode.slice(2), verifiedRows: rows }));
  } finally {
    activeKey.fill(0);
    nextKey.fill(0);
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error("Credential key rotation failed. Verify the mode, database and current/next key configuration.");
    process.exitCode = 1;
  });
}
