import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import { httpsUrl, read as ssrfRead } from "../../connectors/web/http";
import {
  decryptCredentialSecret,
  deriveCredentialKey,
  encryptCredentialSecret,
  maskSecret,
} from "../../shared/credentials-crypto";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { getUserEmailsByIds, writeAuditLog } from "../access/index";

export type AiCredentialProviderName = "artificial_analysis" | "ai_llm" | "openrouter";

const AI_CREDENTIAL_PROVIDERS: readonly AiCredentialProviderName[] = [
  "artificial_analysis",
  "ai_llm",
  "openrouter",
];

export interface AiCredentialConfig {
  apiUrl?: string;
  model?: string;
  publicRedistribution?: boolean;
}

export interface AiCredentialStatus {
  provider: AiCredentialProviderName;
  configured: boolean;
  source: "database" | "env" | "none";
  keyHint: string;
  config: AiCredentialConfig;
  revision: number;
  updatedByEmail: string | null;
  updatedAt: string | null;
}

interface StoredAiCredential {
  apiKey?: string;
  keyHint: string;
  config: AiCredentialConfig;
  revision: number;
  updatedBy: string | null;
  updatedAt: string;
}

function validateApiKeyFormat(raw: string): string {
  const token = raw.trim();
  if (token.length < 8 || token.length > 512 || /[\u0000-\u0020\u007f]/.test(token)) {
    fail(422, "API key must be 8-512 non-whitespace characters");
  }
  return token;
}

function sanitizeConfig(
  provider: AiCredentialProviderName,
  raw?: AiCredentialConfig,
): AiCredentialConfig {
  if (!raw) return {};
  if (provider === "artificial_analysis") {
    return typeof raw.publicRedistribution === "boolean"
      ? { publicRedistribution: raw.publicRedistribution }
      : {};
  }
  if (provider === "ai_llm") {
    const out: AiCredentialConfig = {};
    if (raw.apiUrl !== undefined) {
      const trimmed = raw.apiUrl.trim();
      if (trimmed) {
        const parsed = httpsUrl(trimmed);
        if (!parsed) fail(422, "LLM endpoint URL must use HTTPS with a public hostname");
        out.apiUrl = parsed.href;
      }
    }
    if (raw.model !== undefined) {
      const model = raw.model.trim();
      if (model.length > 120) fail(422, "Model name exceeds 120 characters");
      if (model) out.model = model;
    }
    return out;
  }
  return {};
}

export function createAiCredentialVault(pool: Pool, sessionSecret: string, env = process.env) {
  const encryptionKey = deriveCredentialKey(sessionSecret, env);
  const dbRows = new Map<AiCredentialProviderName, StoredAiCredential>();
  let loaded = false;

  const readEnv = (provider: AiCredentialProviderName): { apiKey?: string; config: AiCredentialConfig } => {
    if (provider === "artificial_analysis") {
      return {
        apiKey: env.ARTIFICIAL_ANALYSIS_API_KEY?.trim() || undefined,
        config: { publicRedistribution: env.ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION === "true" },
      };
    }
    if (provider === "ai_llm") {
      return {
        apiKey: env.AI_LLM_API_KEY?.trim() || undefined,
        config: {
          apiUrl: env.AI_LLM_API_URL?.trim() || undefined,
          model: env.AI_LLM_MODEL?.trim() || undefined,
        },
      };
    }
    return {
      apiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
      config: {},
    };
  };

  async function reload() {
    const res = await pool.query<{
      provider: AiCredentialProviderName;
      encrypted_secret: string;
      key_hint: string;
      config_json: AiCredentialConfig | null;
      revision: number;
      updated_by: string | null;
      updated_at: Date;
    }>(
      "SELECT provider, encrypted_secret, key_hint, config_json, revision, updated_by, updated_at FROM ai_provider_credential",
    );
    dbRows.clear();
    for (const row of res.rows) {
      dbRows.set(row.provider, {
        apiKey: row.encrypted_secret ? decryptCredentialSecret(row.encrypted_secret, encryptionKey) : undefined,
        keyHint: row.key_hint || "",
        config: row.config_json ?? {},
        revision: Number(row.revision ?? 1),
        updatedBy: row.updated_by,
        updatedAt: row.updated_at.toISOString(),
      });
    }
    loaded = true;
  }

  async function ensureLoaded() {
    if (!loaded) await reload().catch(() => {});
  }

  function resolve(provider: AiCredentialProviderName) {
    const fromEnv = readEnv(provider);
    const stored = dbRows.get(provider);
    const apiKey = stored?.apiKey ?? fromEnv.apiKey;
    const source: "database" | "env" | "none" = stored?.apiKey
      ? "database"
      : fromEnv.apiKey
        ? "env"
        : "none";
    const config: AiCredentialConfig = {
      ...fromEnv.config,
      ...(stored?.config ?? {}),
    };
    const configured = provider === "ai_llm"
      ? Boolean(apiKey && config.apiUrl)
      : Boolean(apiKey);
    return { apiKey, config, source, configured };
  }

  async function listStatuses(): Promise<AiCredentialStatus[]> {
    await ensureLoaded();
    const userIds = [...dbRows.values()].map((r) => r.updatedBy).filter(Boolean) as string[];
    const emailMap = await getUserEmailsByIds(pool, userIds);
    return AI_CREDENTIAL_PROVIDERS.map((provider) => {
      const stored = dbRows.get(provider);
      const effective = resolve(provider);
      return {
        provider,
        configured: effective.configured,
        source: effective.source,
        keyHint: stored?.keyHint || (effective.source === "env" && effective.apiKey ? maskSecret(effective.apiKey) : ""),
        config: effective.config,
        revision: stored?.revision ?? 0,
        updatedByEmail: stored?.updatedBy ? emailMap.get(stored.updatedBy) ?? null : null,
        updatedAt: stored?.updatedAt ?? null,
      };
    });
  }

  async function save(
    provider: AiCredentialProviderName,
    actor: Actor,
    input: { apiKey?: string; config?: AiCredentialConfig },
  ): Promise<AiCredentialStatus> {
    await ensureLoaded();
    const cleanConfig = sanitizeConfig(provider, input.config);
    const existing = dbRows.get(provider);
    const nextConfig: AiCredentialConfig = { ...(existing?.config ?? {}), ...cleanConfig };
    const cleanKey = input.apiKey?.trim() ? validateApiKeyFormat(input.apiKey) : undefined;
    const encryptedSecret = cleanKey ? encryptCredentialSecret(cleanKey, encryptionKey) : undefined;
    const keyHint = cleanKey ? maskSecret(cleanKey) : undefined;

    if (!existing && !encryptedSecret && !readEnv(provider).apiKey) {
      fail(422, "An API key is required when configuring this AI credential for the first time");
    }
    if (provider === "ai_llm" && !nextConfig.apiUrl && !readEnv(provider).config.apiUrl) {
      fail(422, "ai_llm requires a valid HTTPS API endpoint URL");
    }

    await transaction(pool, async (client) => {
      await client.query(
        `INSERT INTO ai_provider_credential (provider, encrypted_secret, key_hint, config_json, updated_by, updated_at, revision)
         VALUES ($1, COALESCE($2, ''), COALESCE($3, ''), $4::jsonb, $5, NOW(), 1)
         ON CONFLICT (provider) DO UPDATE SET
           encrypted_secret = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE ai_provider_credential.encrypted_secret END,
           key_hint = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE ai_provider_credential.key_hint END,
           config_json = $4::jsonb,
           updated_by = $5,
           updated_at = NOW(),
           revision = ai_provider_credential.revision + 1`,
        [provider, encryptedSecret ?? null, keyHint ?? null, JSON.stringify(nextConfig), actor.userId],
      );
      await writeAuditLog(client, {
        actorUserId: actor.userId,
        actorType: "session",
        action: "ai.credential.save",
        resourceId: provider,
      });
    });
    await reload();
    const list = await listStatuses();
    return list.find((item) => item.provider === provider)!;
  }

  async function remove(provider: AiCredentialProviderName, actor: Actor): Promise<{ deleted: boolean }> {
    const deleted = await transaction(pool, async (client) => {
      const res = await client.query("DELETE FROM ai_provider_credential WHERE provider = $1", [provider]);
      if (res.rowCount) {
        await writeAuditLog(client, {
          actorUserId: actor.userId,
          actorType: "session",
          action: "ai.credential.delete",
          resourceId: provider,
        });
      }
      return Boolean(res.rowCount);
    });
    await reload();
    return { deleted };
  }

  async function testConnection(
    provider: AiCredentialProviderName,
    input: { apiKey?: string; apiUrl?: string } = {},
  ): Promise<{ ok: boolean; status: number; message: string }> {
    await ensureLoaded();
    const resolved = resolve(provider);
    const key = input.apiKey?.trim() ? validateApiKeyFormat(input.apiKey) : resolved.apiKey;
    if (!key && provider !== "openrouter") {
      return { ok: false, status: 422, message: "Credential API key is not configured" };
    }
    if (provider === "artificial_analysis") {
      const url = httpsUrl("https://artificialanalysis.ai/api/v2/data/llms/models")!;
      try {
        const res = await ssrfRead(url, undefined, { "x-api-key": key! }, 6000);
        return { ok: res.status >= 200 && res.status < 300, status: res.status, message: `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, status: 502, message: err instanceof Error ? err.message : String(err) };
      }
    }
    if (provider === "openrouter") {
      const url = httpsUrl("https://openrouter.ai/api/v1/models")!;
      const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
      try {
        const res = await ssrfRead(url, undefined, headers, 6000);
        return { ok: res.status >= 200 && res.status < 300, status: res.status, message: `HTTP ${res.status}` };
      } catch (err) {
        return { ok: false, status: 502, message: err instanceof Error ? err.message : String(err) };
      }
    }
    const rawUrl = (input.apiUrl ?? resolved.config.apiUrl ?? "").trim();
    const target = httpsUrl(rawUrl);
    if (!target) return { ok: false, status: 422, message: "LLM endpoint URL must be valid HTTPS" };
    const modelsUrl = target.pathname.endsWith("/chat/completions")
      ? new URL(target.href.replace(/\/chat\/completions$/, "/models"))
      : new URL("/v1/models", target.origin);
    try {
      const res = await ssrfRead(modelsUrl, undefined, { Authorization: `Bearer ${key!}` }, 6000);
      return { ok: res.status >= 200 && res.status < 400, status: res.status, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, status: 502, message: err instanceof Error ? err.message : String(err) };
    }
  }

  return { reload, ensureLoaded, resolve, listStatuses, save, remove, testConnection };
}

export type AiCredentialVault = ReturnType<typeof createAiCredentialVault>;
