import assert from "node:assert/strict";
import test from "node:test";
import { rotateCredentialKey } from "../../src/modules/collection/credential-rotation";
import { decryptCredentialSecret, deriveCredentialKey, encryptCredentialSecret } from "../../src/modules/collection/credentials";
import { testDatabase } from "../helpers/database";

test("PG16 key rotation verifies ciphertext and rolls back on any invalid row", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const active = deriveCredentialKey("fixture-session-credential-key", {});
  const next = deriveCredentialKey("", { CREDENTIALS_MASTER_KEY: "fixture-independent-credential-key" });
  const encrypted = encryptCredentialSecret("synthetic-key", active);
  await db.pool.query("INSERT INTO source_provider_credential(provider,encrypted_secret,key_hint) VALUES($1,$2,$3),($4,$5,$3)",
    ["apify", encrypted, "fixture", "twitterapis", "invalid fixture"]);
  const read = () => db.pool.query("SELECT encrypted_secret,revision FROM source_provider_credential WHERE provider=$1", ["apify"]);
  const before = (await read()).rows[0];
  await assert.rejects(rotateCredentialKey(db.pool, active, next, true));
  assert.deepEqual((await read()).rows[0], before);
  await db.pool.query("UPDATE source_provider_credential SET encrypted_secret=$1 WHERE provider=$2", [encrypted, "twitterapis"]);
  assert.equal(await rotateCredentialKey(db.pool, active, next, false), 2);
  assert.deepEqual((await read()).rows[0], before);
  assert.equal(await rotateCredentialKey(db.pool, active, next, true), 2);
  const after = (await read()).rows[0];
  assert.equal(after.revision, before.revision + 1);
  assert.equal(decryptCredentialSecret(after.encrypted_secret, next), "synthetic-key");
  assert.throws(() => decryptCredentialSecret(after.encrypted_secret, active));
});
