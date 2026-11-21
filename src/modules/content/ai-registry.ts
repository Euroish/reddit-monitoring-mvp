import { createHash } from "node:crypto";

export interface NormalizedRegistryItem {
  sourceNamespace: "openrouter" | "litellm" | "hf" | "epoch";
  externalId: string;
  routeVariant: string;
  vendorSlugHint: string | null;
  displayName: string;
  registryCreatedAt: string | null;
  contextLength: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  currency: string;
  priceUnit: "per_token" | "per_1k_tokens" | "per_1m_tokens" | "per_request" | "other";
  inputPrice: string | null;
  outputPrice: string | null;
  cacheReadPrice: string | null;
  rawUnitNote: string;
  providerName: string | null;
  contentHash: string;
  normalizedPayload: Record<string, unknown>;
  historicalDate?: { date: string | null; precision: "day" | "month" | "unknown"; url: string | null };
}

export interface ParsedBenchmarkSnapshot {
  category: "general" | "coding" | "reasoning" | "speed_price";
  metricName: string;
  metricVersion: string;
  metricDirection: "higher" | "lower";
  unit: string | null;
  attributionText: string;
  attributionUrl: string;
  entries: Array<{
    externalModelId: string;
    modelName: string;
    vendorName: string | null;
    score: number;
    rank: number;
    providerSetting: string | null;
  }>;
}

const VENDOR_PREFIX_MAP: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "google-deepmind": "google",
  "meta-llama": "meta",
  meta: "meta",
  deepseek: "deepseek",
  "deepseek-ai": "deepseek",
  qwen: "qwen",
  moonshotai: "moonshot",
  moonshot: "moonshot",
  "z-ai": "zai",
  "zai-org": "zai",
  thudm: "zai",
  zhipu: "zai",
  mistralai: "mistral",
  mistral: "mistral",
  "x-ai": "xai",
  "xai-org": "xai",
  xai: "xai",
};

export function inferVendorSlug(prefixOrOrg: string | null | undefined): string | null {
  if (!prefixOrOrg) return null;
  const key = prefixOrOrg.trim().toLowerCase();
  return VENDOR_PREFIX_MAP[key] ?? null;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeNumericString(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return n.toFixed(8);
}

function safePositiveInt(val: unknown): number | null {
  const n = Number(val);
  return Number.isInteger(n) && n > 0 && n <= 100_000_000 ? n : null;
}

export function parseOpenRouterPayload(raw: unknown): NormalizedRegistryItem[] {
  const list = Array.isArray((raw as { data?: unknown[] })?.data)
    ? ((raw as { data: unknown[] }).data)
    : [];
  const out: NormalizedRegistryItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!id) continue;
    const [prefix, ...rest] = id.split("/");
    const slug = typeof obj.canonical_slug === "string" && obj.canonical_slug.trim() ? obj.canonical_slug.trim() : id;
    const routeVariant = id.includes(":") ? id.split(":").slice(1).join(":") : "default";
    const createdSec = typeof obj.created === "number" && Number.isFinite(obj.created) ? obj.created : null;
    const arch = (obj.architecture && typeof obj.architecture === "object" ? obj.architecture : {}) as Record<string, unknown>;
    const pricing = (obj.pricing && typeof obj.pricing === "object" ? obj.pricing : {}) as Record<string, unknown>;
    const topProvider = (obj.top_provider && typeof obj.top_provider === "object" ? obj.top_provider : {}) as Record<string, unknown>;
    const inputMod = Array.isArray(arch.input_modalities) ? arch.input_modalities.filter((x): x is string => typeof x === "string") : [];
    const outputMod = Array.isArray(arch.output_modalities) ? arch.output_modalities.filter((x): x is string => typeof x === "string") : [];
    const inputPrice = safeNumericString(pricing.prompt);
    const outputPrice = safeNumericString(pricing.completion);
    const cacheReadPrice = safeNumericString(pricing.input_cache_read);
    const contextLength = safePositiveInt(obj.context_length);
    const maxOutputTokens = safePositiveInt(topProvider.max_completion_tokens);
    const displayName = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : (rest.join("/") || id);
    const normalizedPayload = {
      id,
      canonicalSlug: slug,
      displayName,
      contextLength,
      maxOutputTokens,
      inputModalities: inputMod,
      outputModalities: outputMod,
      inputPrice,
      outputPrice,
      cacheReadPrice,
    };
    out.push({
      sourceNamespace: "openrouter",
      externalId: slug,
      routeVariant,
      vendorSlugHint: inferVendorSlug(prefix),
      displayName,
      registryCreatedAt: createdSec ? new Date(createdSec * 1000).toISOString() : null,
      contextLength,
      maxOutputTokens,
      inputModalities: inputMod,
      outputModalities: outputMod,
      currency: "USD",
      priceUnit: "per_token",
      inputPrice,
      outputPrice,
      cacheReadPrice,
      rawUnitNote: "OpenRouter pricing (USD per token; multiply by 1e6 for per-1M tokens)",
      providerName: "openrouter",
      contentHash: stableHash(normalizedPayload),
      normalizedPayload,
    });
  }
  return out;
}

export function parseLiteLlmPayload(raw: unknown): NormalizedRegistryItem[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: NormalizedRegistryItem[] = [];
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "sample_spec" || !val || typeof val !== "object" || Array.isArray(val)) continue;
    const obj = val as Record<string, unknown>;
    const provider = typeof obj.litellm_provider === "string" ? obj.litellm_provider.trim() : null;
    const prefix = key.includes("/") ? key.split("/")[0] : provider;
    const contextLength = safePositiveInt(obj.max_input_tokens ?? obj.max_tokens);
    const maxOutputTokens = safePositiveInt(obj.max_output_tokens);
    const inputPrice = safeNumericString(obj.input_cost_per_token);
    const outputPrice = safeNumericString(obj.output_cost_per_token);
    const cacheReadPrice = safeNumericString(obj.cache_read_input_token_cost);
    const normalizedPayload = {
      key,
      provider,
      contextLength,
      maxOutputTokens,
      inputPrice,
      outputPrice,
      cacheReadPrice,
    };
    out.push({
      sourceNamespace: "litellm",
      externalId: key.slice(0, 256),
      routeVariant: provider ? provider.slice(0, 128) : "default",
      vendorSlugHint: inferVendorSlug(prefix),
      displayName: key,
      registryCreatedAt: null,
      contextLength,
      maxOutputTokens,
      inputModalities: [],
      outputModalities: [],
      currency: "USD",
      priceUnit: "per_token",
      inputPrice,
      outputPrice,
      cacheReadPrice,
      rawUnitNote: "LiteLLM community map (USD per token; community-maintained observation)",
      providerName: provider,
      contentHash: stableHash(normalizedPayload),
      normalizedPayload,
    });
  }
  return out;
}

export function parseHuggingFacePayload(raw: unknown, allowedOrgs: string[]): NormalizedRegistryItem[] {
  if (!Array.isArray(raw)) return [];
  const orgSet = new Set(allowedOrgs.map((o) => o.toLowerCase()));
  const out: NormalizedRegistryItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const repoId = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!repoId || !repoId.includes("/")) continue;
    const [org, repoName] = repoId.split("/");
    if (!orgSet.has(org.toLowerCase())) continue; // Reject third-party mirrors
    const createdAt = typeof obj.createdAt === "string" && Number.isFinite(Date.parse(obj.createdAt))
      ? new Date(obj.createdAt).toISOString()
      : null;
    const tags = Array.isArray(obj.tags) ? obj.tags.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
    const normalizedPayload = { repoId, org, pipelineTag: obj.pipeline_tag ?? null, tags };
    out.push({
      sourceNamespace: "hf",
      externalId: repoId,
      routeVariant: "hub",
      vendorSlugHint: inferVendorSlug(org),
      displayName: repoName || repoId,
      registryCreatedAt: createdAt,
      contextLength: null,
      maxOutputTokens: null,
      inputModalities: [],
      outputModalities: [],
      currency: "USD",
      priceUnit: "other",
      inputPrice: null,
      outputPrice: null,
      cacheReadPrice: null,
      rawUnitNote: "Hugging Face official organization repository metadata",
      providerName: "huggingface",
      contentHash: stableHash(normalizedPayload),
      normalizedPayload,
    });
  }
  return out;
}

export function parseEpochDate(raw: string | undefined): { date: string | null; precision: "day" | "month" | "unknown" } {
  const s = (raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { date: s, precision: "day" };
  if (/^\d{4}-\d{2}$/.test(s)) return { date: `${s}-01`, precision: "month" };
  return { date: null, precision: "unknown" };
}

export function parseEpochCsv(csvText: string, limit = 100): NormalizedRegistryItem[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const idxModel = headers.findIndex((h) => h === "model" || h === "system");
  const idxOrg = headers.findIndex((h) => h === "organization");
  const idxDate = headers.findIndex((h) => h === "publication date");
  const idxLink = headers.findIndex((h) => h === "link" || h === "reference");
  if (idxModel < 0) return [];
  const out: NormalizedRegistryItem[] = [];
  for (let i = 1; i < lines.length && out.length < limit; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const model = cols[idxModel] ?? "";
    if (!model) continue;
    const org = idxOrg >= 0 ? cols[idxOrg] : "";
    const parsedDate = parseEpochDate(idxDate >= 0 ? cols[idxDate] : "");
    const url = idxLink >= 0 && /^https?:\/\//i.test(cols[idxLink] ?? "") ? cols[idxLink] : null;
    const normalizedPayload = { model, org, date: parsedDate.date, precision: parsedDate.precision, url };
    out.push({
      sourceNamespace: "epoch",
      externalId: model.slice(0, 256),
      routeVariant: "notable_csv",
      vendorSlugHint: inferVendorSlug(org.split(/\s+/)[0]),
      displayName: model,
      registryCreatedAt: null,
      contextLength: null,
      maxOutputTokens: null,
      inputModalities: [],
      outputModalities: [],
      currency: "USD",
      priceUnit: "other",
      inputPrice: null,
      outputPrice: null,
      cacheReadPrice: null,
      rawUnitNote: "Epoch AI notable_ai_models.csv (CC-BY attribution; historical archive only)",
      providerName: "epoch",
      contentHash: stableHash(normalizedPayload),
      normalizedPayload,
      historicalDate: { ...parsedDate, url },
    });
  }
  return out;
}

export function parseArtificialAnalysisPayload(raw: unknown): ParsedBenchmarkSnapshot[] {
  const list = Array.isArray((raw as { data?: unknown[] })?.data)
    ? ((raw as { data: unknown[] }).data)
    : [];
  const defs: Array<{
    category: ParsedBenchmarkSnapshot["category"];
    metricName: string;
    field: string;
    direction: "higher" | "lower";
    unit: string | null;
  }> = [
    { category: "general", metricName: "Artificial Analysis Intelligence Index", field: "artificial_analysis_intelligence_index", direction: "higher", unit: "pts" },
    { category: "coding", metricName: "Artificial Analysis Coding Index", field: "artificial_analysis_coding_index", direction: "higher", unit: "pts" },
    { category: "reasoning", metricName: "Artificial Analysis Math Index", field: "artificial_analysis_math_index", direction: "higher", unit: "pts" },
    { category: "speed_price", metricName: "Median Output Tokens/sec", field: "median_output_tokens_per_second", direction: "higher", unit: "tok/s" },
  ];
  const snapshots: ParsedBenchmarkSnapshot[] = [];
  for (const def of defs) {
    const rows: ParsedBenchmarkSnapshot["entries"] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const evals = (obj.evaluations && typeof obj.evaluations === "object" ? obj.evaluations : {}) as Record<string, unknown>;
      const rawVal = evals[def.field] ?? obj[def.field];
      const score = Number(rawVal);
      const id = typeof obj.id === "string" || typeof obj.slug === "string" ? String(obj.id ?? obj.slug) : "";
      const name = typeof obj.name === "string" ? obj.name : id;
      const creator = (obj.model_creator && typeof obj.model_creator === "object" ? obj.model_creator : {}) as Record<string, unknown>;
      if (!id || !Number.isFinite(score) || score <= 0) continue;
      rows.push({
        externalModelId: id,
        modelName: name,
        vendorName: typeof creator.name === "string" ? creator.name : null,
        score,
        rank: 0,
        providerSetting: null,
      });
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => (def.direction === "higher" ? b.score - a.score : a.score - b.score));
    rows.forEach((r, idx) => { r.rank = idx + 1; });
    snapshots.push({
      category: def.category,
      metricName: def.metricName,
      metricVersion: "aa-v2",
      metricDirection: def.direction,
      unit: def.unit,
      attributionText: "Data provided by Artificial Analysis (artificialanalysis.ai)",
      attributionUrl: "https://artificialanalysis.ai/",
      entries: rows.slice(0, 50),
    });
  }
  return snapshots;
}
