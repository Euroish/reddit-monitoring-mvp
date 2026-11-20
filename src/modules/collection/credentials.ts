import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool } from "pg";
import {
  CredentialProvider,
  ProviderCredentialInput,
  ProviderCredentialTestInput,
  type Actor,
} from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";

export type CredentialProviderName = "kaix" | "red_crawler" | "twitterapis" | "scrapebadger";

const PROVIDERS: readonly CredentialProviderName[] = ["kaix", "red_crawler", "twitterapis", "scrapebadger"];
const ENV_KEY_BY_PROVIDER: Record<CredentialProviderName, string> = {
  kaix: "APIFY_API_TOKEN",
  red_crawler: "APIFY_API_TOKEN",
  twitterapis: "TWITTERAPIS_API_KEY",
  scrapebadger: "SCRAPEBADGER_API_KEY",
};

export function deriveCredentialKey(sessionSecret: string, env = process.env): Buffer {
  const master = env.CREDENTIALS_MASTER_KEY?.trim() || sessionSecret;
  if (master.length < 16) throw new Error("Credential master key material must have at least 16 characters");
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.from("siftline-provider-credentials-v1"), Buffer.from("aes-256-gcm"), 32),
  );
}

export function encryptCredentialSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptCredentialSecret(payload: string, key: Buffer): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported credential ciphertext format");
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  const ciphertext = Buffer.from(parts[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 8) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

function validateApiKeyFormat(raw: string): string {
  const token = raw.trim();
  if (token.length < 8 || token.length > 512 || /[\u0000-\u0020\u007f]/.test(token)) {
    fail(422, "API key must be 8-512 non-whitespace characters");
  }
  return token;
}

export function createCredentialVault(pool: Pool, sessionSecret: string, env = process.env) {
  const encryptionKey = deriveCredentialKey(sessionSecret, env);
  const dbSecrets = new Map<CredentialProviderName, string>();
  const envSecret = (provider: CredentialProviderName) => env[ENV_KEY_BY_PROVIDER[provider]]?.trim() || undefined;

  async function reload() {
    const res = await pool.query<{ provider: CredentialProviderName; encrypted_secret: string }>(
      "SELECT provider, encrypted_secret FROM source_provider_credential",
    );
    const next = new Map<CredentialProviderName, string>();
    for (const row of res.rows) {
      next.set(row.provider, decryptCredentialSecret(row.encrypted_secret, encryptionKey));
    }
    dbSecrets.clear();
    for (const [k, v] of next) dbSecrets.set(k, v);
  }

  function getSecret(provider: CredentialProviderName): string | undefined {
    return dbSecrets.get(provider) ?? envSecret(provider);
  }

  async function listStatus() {
    const rows = (
      await pool.query<{
        provider: CredentialProviderName;
        key_hint: string;
        revision: number;
        updated_at: string;
        updated_by_email: string | null;
      }>(
        `SELECT c.provider,c.key_hint,c.revision,c.updated_at,u.email AS updated_by_email
         FROM source_provider_credential c LEFT JOIN app_user u ON u.id=c.updated_by`,
      )
    ).rows;
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    return PROVIDERS.map((provider) => {
      const dbRow = byProvider.get(provider);
      const envVal = envSecret(provider);
      const source = dbRow ? ("db" as const) : envVal ? ("env" as const) : ("none" as const);
      return {
        provider,
        envVar: ENV_KEY_BY_PROVIDER[provider],
        source,
        configured: source !== "none",
        keyHint: dbRow ? dbRow.key_hint : envVal ? maskSecret(envVal) : null,
        envConfigured: Boolean(envVal),
        envHint: envVal ? maskSecret(envVal) : null,
        revision: dbRow?.revision ?? 0,
        updatedAt: dbRow?.updated_at ?? null,
        updatedByEmail: dbRow?.updated_by_email ?? null,
      };
    });
  }

  async function upsertCredential(
    provider: CredentialProviderName,
    rawKey: string,
    actor: Actor,
    revision?: number,
  ) {
    const clean = validateApiKeyFormat(rawKey);
    const keyHint = maskSecret(clean);
    const encrypted = encryptCredentialSecret(clean, encryptionKey);
    await transaction(pool, async (client) => {
      const existing = (
        await client.query<{ revision: number }>(
          "SELECT revision FROM source_provider_credential WHERE provider=$1 FOR UPDATE",
          [provider],
        )
      ).rows[0];
      if (existing && revision !== undefined && existing.revision !== revision) {
        fail(409, "Credential revision changed; reload before saving");
      }
      await client.query(
        `INSERT INTO source_provider_credential(provider,encrypted_secret,key_hint,updated_by,updated_at,revision)
         VALUES($1,$2,$3,$4,NOW(),1)
         ON CONFLICT (provider) DO UPDATE
         SET encrypted_secret=EXCLUDED.encrypted_secret,key_hint=EXCLUDED.key_hint,
             updated_by=EXCLUDED.updated_by,updated_at=NOW(),revision=source_provider_credential.revision+1`,
        [provider, encrypted, keyHint, actor.userId],
      );
      await client.query(
        `INSERT INTO app_audit_log(id,actor_user_id,action,resource_type,resource_id,meta_json)
         VALUES($1,$2,'collection.credential.saved','source_provider_credential',$3,$4::jsonb)`,
        [randomUUID(), actor.userId, provider, JSON.stringify({ provider, keyHint })],
      );
    });
    await reload();
    return (await listStatus()).find((item) => item.provider === provider)!;
  }

  async function revokeCredential(provider: CredentialProviderName, actor: Actor) {
    await transaction(pool, async (client) => {
      await client.query("DELETE FROM source_provider_credential WHERE provider=$1", [provider]);
      await client.query(
        `INSERT INTO app_audit_log(id,actor_user_id,action,resource_type,resource_id,meta_json)
         VALUES($1,$2,'collection.credential.revoked','source_provider_credential',$3,$4::jsonb)`,
        [randomUUID(), actor.userId, provider, JSON.stringify({ provider })],
      );
    });
    await reload();
    return (await listStatus()).find((item) => item.provider === provider)!;
  }

  return { reload, getSecret, listStatus, upsertCredential, revokeCredential, env };
}

export type CredentialVault = ReturnType<typeof createCredentialVault>;

function requireAdminBrowser(actor: Actor) {
  if (actor.clientKind !== "browser" || actor.role === "viewer") {
    fail(403, "Administrator browser session required");
  }
}

export async function credentialRoutes(
  app: FastifyInstance,
  vault: CredentialVault,
  fetchPage: typeof fetch = fetch,
) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/sources/credentials", async (request) => {
    requireAdminBrowser(request.actor!);
    return {
      networkEnabled: vault.env.SOURCE_NETWORK_ENABLED === "true",
      credentials: await vault.listStatus(),
    };
  });
  api.put(
    "/v1/sources/credentials/:provider",
    {
      schema: {
        params: Type.Object({ provider: CredentialProvider }),
        body: ProviderCredentialInput,
      },
    },
    async (request) => {
      requireAdminBrowser(request.actor!);
      const credential = await vault.upsertCredential(
        request.params.provider,
        request.body.apiKey,
        request.actor!,
        request.body.revision,
      );
      return { credential, reloaded: true };
    },
  );
  api.delete(
    "/v1/sources/credentials/:provider",
    { schema: { params: Type.Object({ provider: CredentialProvider }) } },
    async (request) => {
      requireAdminBrowser(request.actor!);
      const credential = await vault.revokeCredential(request.params.provider, request.actor!);
      return { credential, reloaded: true };
    },
  );
  api.post(
    "/v1/sources/credentials/:provider/test",
    {
      schema: {
        params: Type.Object({ provider: CredentialProvider }),
        body: ProviderCredentialTestInput,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      requireAdminBrowser(request.actor!);
      const provider = request.params.provider;
      const secret = vault.getSecret(provider);
      const networkEnabled = vault.env.SOURCE_NETWORK_ENABLED === "true";
      if (!secret) return { ok: false, mode: "dry", reason: "No credential configured" };
      if (!request.body.confirmPaidProbe) {
        return {
          ok: true,
          mode: "dry",
          networkEnabled,
          reason: networkEnabled
            ? "Credential loaded in memory; live upstream probe skipped until confirmed"
            : "Credential loaded in memory (SOURCE_NETWORK_ENABLED=false)",
        };
      }
      if (!networkEnabled) return { ok: false, mode: "live", reason: "SOURCE_NETWORK_ENABLED is false" };
      const timer = AbortSignal.timeout(8000);
      if (provider === "kaix" || provider === "red_crawler") {
        const res = await fetchPage("https://api.apify.com/v2/users/me", {
          headers: { Authorization: `Bearer ${secret}` },
          signal: timer,
          redirect: "error",
        });
        await res.body?.cancel();
        return { ok: res.ok, mode: "live", status: res.status, reason: res.ok ? "Apify token verified" : `HTTP ${res.status}` };
      }
      const probeUrl = provider === "twitterapis"
        ? "https://api.twitterapis.com/twitter/user/info?userName=x"
        : "https://scrapebadger.com/v1/twitter/tweets/advanced_search?query=test&count=1";
      const headers: Record<string, string> = provider === "twitterapis"
        ? { Authorization: `Bearer ${secret}` }
        : { "x-api-key": secret };
      const res = await fetchPage(probeUrl, { headers, signal: timer, redirect: "error" });
      await res.body?.cancel();
      return { ok: res.ok, mode: "live", status: res.status, reason: res.ok ? "Provider endpoint reachable" : `HTTP ${res.status}` };
    },
  );
}
