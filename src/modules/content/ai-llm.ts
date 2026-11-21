import { createHash } from "node:crypto";
import type { Pool } from "pg";
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
  | { status: "budget_exceeded" }
  | { status: "cached"; data: AiLlmExtraction }
  | { status: "ok"; data: AiLlmExtraction }
  | { status: "invalid"; reason: string };

const PROMPT_VERSION = "v1";

function hashContent(input: LlmExtractInput): string {
  return createHash("sha256")
    .update(`${PROMPT_VERSION}|${input.vendorName}|${input.title}|${input.publishedDate ?? ""}|${input.bodyText.slice(0, 4000)}`)
    .digest("hex");
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
          continue;
        }
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM request failed");
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

  const dailyBudget = Math.max(1, options.dailyBudget ?? (Number(process.env.AI_LLM_DAILY_BUDGET ?? "50") || 50));
  const usedRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ai_llm_extraction_cache WHERE created_at >= date_trunc('day', NOW())`,
  );
  if (Number(usedRes.rows[0]?.count ?? "0") >= dailyBudget) {
    return { status: "budget_exceeded" };
  }

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

  try {
    const res = options.fetcher
      ? await options.fetcher(apiUrl, init)
      : await fetchWithRetry(apiUrl, init, options.timeoutMs ?? 10_000, 2);
    if (!res.ok) {
      return { status: "invalid", reason: `LLM HTTP ${res.status}` };
    }
    const envelope = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawText = envelope?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(rawText) as unknown;
    const checked = validateLlmExtraction(parsed, new Set([input.referenceId]));

    await pool.query(
      `INSERT INTO ai_llm_extraction_cache (content_hash, model_name, prompt_version, extracted_payload, valid, error_reason)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        contentHash,
        model,
        PROMPT_VERSION,
        JSON.stringify(checked.ok ? checked.data : { raw: rawText.slice(0, 1000) }),
        checked.ok,
        checked.ok ? null : checked.reason,
      ],
    );
    return checked.ok ? { status: "ok", data: checked.data } : { status: "invalid", reason: checked.reason };
  } catch (err) {
    return { status: "invalid", reason: err instanceof Error ? err.message : "LLM extraction error" };
  }
}
