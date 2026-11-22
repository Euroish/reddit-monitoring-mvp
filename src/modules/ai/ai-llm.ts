import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { httpsUrl } from "../../connectors/web/http";
import { transaction } from "../../storage/db";
import { Value } from "@sinclair/typebox/value";
import { AiLlmExtractionSchema, type AiLlmExtraction } from "../../../packages/contracts/src/ai-catalog";

export function validateLlmExtraction(
  raw: unknown,
  allowedReferenceIds: Set<string>,
): { ok: true; data: AiLlmExtraction } | { ok: false; reason: string } {
  if (!Value.Check(AiLlmExtractionSchema, raw)) {
    return { ok: false, reason: "LLM output failed TypeBox schema validation" };
  }
  const parsed = raw as AiLlmExtraction;
  for (const ev of parsed.evidence) {
    if (!allowedReferenceIds.has(ev.source_reference_id)) {
      return { ok: false, reason: `Unknown source_reference_id: ${ev.source_reference_id}` };
    }
    if (/<script|javascript:|data:text\/html/i.test(ev.excerpt) || /<script|javascript:/i.test(ev.claim)) {
      return { ok: false, reason: "Rejected unsafe markup in evidence" };
    }
  }
  if (parsed.summary_zh && /<script|javascript:/i.test(parsed.summary_zh)) {
    return { ok: false, reason: "Rejected unsafe markup in summary" };
  }
  return { ok: true, data: parsed };
}

export interface LlmExtractInput {
  referenceId: string;
  vendorName: string;
  title: string;
  bodyText: string;
  publishedDate: string | null;
  url: string;
}

export type LlmExtractOutcome =
  | { status: "disabled" }
  | { status: "budget_exceeded" | "busy" }
  | { status: "cached"; data: AiLlmExtraction }
  | { status: "ok"; data: AiLlmExtraction }
  | { status: "invalid"; reason: string };

const PROMPT_VERSION = "v1";
const UNKNOWN_LLM_OUTCOME = "LLM request outcome unknown";
const LLM_BUDGET_LOCK = 9042055;
let activeLlmRequests = 0;

function hashContent(input: LlmExtractInput): string {
  return createHash("sha256")
    .update(`${PROMPT_VERSION}|${input.vendorName}|${input.title}|${input.publishedDate ?? ""}|${input.bodyText.slice(0, 4000)}`)
    .digest("hex");
}

async function reserveLlmRequest(pool: Pool, contentHash: string, model: string, dailyBudget: number) {
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [LLM_BUDGET_LOCK]);
    const used = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM ai_llm_extraction_cache WHERE created_at >= date_trunc('day',NOW(),'UTC')",
    );
    if (used.rows[0].count >= dailyBudget) return false;
    const reservation = await client.query(
      `INSERT INTO ai_llm_extraction_cache (content_hash,model_name,prompt_version,extracted_payload,valid,error_reason)
       VALUES ($1,$2,$3,'{}',false,$4) ON CONFLICT (content_hash) DO NOTHING`,
      [contentHash, model, PROMPT_VERSION, UNKNOWN_LLM_OUTCOME],
    );
    return reservation.rowCount === 1;
  });
}

async function readLlmResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing LLM response body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 128 * 1024) {
        await reader.cancel();
        throw new Error("LLM response body too large");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as { choices?: Array<{ message?: { content?: string } }> };
  } finally {
    reader.releaseLock();
  }
}

export async function extractWithOptionalLlm(
  pool: Pool,
  input: LlmExtractInput,
  options: {
    apiUrl?: string;
    apiKey?: string;
    model?: string;
    dailyBudget?: number;
    timeoutMs?: number;
    fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  } = {},
): Promise<LlmExtractOutcome> {
  const apiUrl = (options.apiUrl ?? process.env.AI_LLM_API_URL ?? "").trim();
  const apiKey = (options.apiKey ?? process.env.AI_LLM_API_KEY ?? "").trim();
  const model = (options.model ?? process.env.AI_LLM_MODEL ?? "gpt-4o-mini").trim();
  if (!apiUrl || !apiKey) return { status: "disabled" };
  const target = httpsUrl(apiUrl);
  if (!target) return { status: "invalid", reason: "LLM endpoint must use HTTPS with a hostname" };

  const contentHash = hashContent(input);
  const cached = await pool.query<{ extracted_payload: AiLlmExtraction; valid: boolean; error_reason: string | null }>(
    `SELECT extracted_payload, valid, error_reason FROM ai_llm_extraction_cache WHERE content_hash = $1 LIMIT 1`,
    [contentHash],
  );
  if (cached.rows[0]) {
    return cached.rows[0].valid
      ? { status: "cached", data: cached.rows[0].extracted_payload }
      : { status: "invalid", reason: cached.rows[0].error_reason ?? "Cached invalid extraction" };
  }

  const dailyBudget = Math.min(1000, Math.max(1, Number(options.dailyBudget ?? process.env.AI_LLM_DAILY_BUDGET) || 50));

  const systemPrompt =
    "Extract official AI model release metadata as strict JSON matching the schema. " +
    "Never invent dates or model names. Cite only the provided source_reference_id. " +
    "If evidence is insufficient, set insufficient_evidence=true and null dates.";
  const userPrompt = JSON.stringify({
    source_reference_id: input.referenceId,
    vendor: input.vendorName,
    title: input.title,
    published_date: input.publishedDate,
    url: input.url,
    excerpt: input.bodyText.slice(0, 3000),
  });

  const init: RequestInit = {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  };

  if (activeLlmRequests >= 2) return { status: "busy" };
  activeLlmRequests++;
  try {
    if (!(await reserveLlmRequest(pool, contentHash, model, dailyBudget))) return { status: "budget_exceeded" };
    const res = await (options.fetcher ?? fetch)(target.href, init);
    if (!res.ok) {
      await res.body?.cancel();
      return { status: "invalid", reason: `LLM HTTP ${res.status}` };
    }
    const envelope = await readLlmResponse(res);
    const rawText = envelope?.choices?.[0]?.message?.content ?? "";
    const checked = validateLlmExtraction(JSON.parse(rawText), new Set([input.referenceId]));
    const reason = checked.ok ? null : "LLM response failed evidence validation";
    await pool.query(
      `UPDATE ai_llm_extraction_cache SET extracted_payload=$2::jsonb, valid=$3, error_reason=$4 WHERE content_hash=$1`,
      [contentHash, JSON.stringify(checked.ok ? checked.data : {}), checked.ok, reason],
    );
    return checked.ok ? { status: "ok", data: checked.data } : { status: "invalid", reason: reason! };
  } catch {
    return { status: "invalid", reason: UNKNOWN_LLM_OUTCOME };
  } finally {
    activeLlmRequests--;
  }
}
