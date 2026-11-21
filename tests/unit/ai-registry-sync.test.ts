import assert from "node:assert/strict";
import test from "node:test";
import {
  isOfficialVendorUrl,
  parseArtificialAnalysisPayload,
  parseEpochCsv,
  parseEpochDate,
  parseHuggingFacePayload,
  parseLiteLlmPayload,
  parseOpenRouterPayload,
} from "../../src/modules/content/ai-registry.js";
import { classifyOfficialAnnouncement } from "../../src/modules/content/ai-discovery.js";
import { validateLlmExtraction } from "../../src/modules/content/ai-sync.js";

test("parseOpenRouterPayload extracts vendor hint, context and raw pricing with unit", () => {
  const payload = {
    data: [
      {
        id: "anthropic/claude-sonnet-4",
        canonical_slug: "anthropic/claude-sonnet-4-20250514",
        name: "Anthropic: Claude Sonnet 4",
        created: 1747267200,
        context_length: 200000,
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        pricing: { prompt: "0.000003", completion: "0.000015" },
        top_provider: { max_completion_tokens: 64000 },
      },
      {
        id: "unknown-lab/mystery-model",
        name: "Mystery Model",
      },
    ],
  };

  const items = parseOpenRouterPayload(payload);
  assert.equal(items.length, 2);
  assert.equal(items[0].vendorSlugHint, "anthropic");
  assert.equal(items[0].externalId, "anthropic/claude-sonnet-4-20250514");
  assert.equal(items[0].contextLength, 200000);
  assert.equal(items[0].maxOutputTokens, 64000);
  assert.equal(items[0].priceUnit, "per_token");
  assert.equal(Number(items[0].inputPrice), 0.000003);
  assert.equal(Number(items[0].outputPrice), 0.000015);
  assert.equal(items[0].registryCreatedAt, "2025-05-15T00:00:00.000Z");
  assert.equal(items[1].vendorSlugHint, null);
});

test("parseLiteLlmPayload skips sample_spec and preserves raw per-token pricing", () => {
  const payload = {
    sample_spec: { max_tokens: 1000 },
    "openai/gpt-5": {
      litellm_provider: "openai",
      max_input_tokens: 400000,
      max_output_tokens: 128000,
      input_cost_per_token: 0.00000125,
      output_cost_per_token: 0.00001,
      mode: "chat",
    },
    "deepseek-chat": {
      litellm_provider: "deepseek",
      max_tokens: 128000,
      input_cost_per_token: 0.00000027,
      output_cost_per_token: 0.0000011,
      mode: "chat",
    },
  };

  const items = parseLiteLlmPayload(payload);
  assert.equal(items.length, 2);
  const gpt5 = items.find((i) => i.externalId === "openai/gpt-5");
  assert.ok(gpt5);
  assert.equal(gpt5.vendorSlugHint, "openai");
  assert.equal(gpt5.contextLength, 400000);
  assert.equal(gpt5.maxOutputTokens, 128000);
  assert.equal(gpt5.priceUnit, "per_token");
  assert.equal(Number(gpt5.inputPrice), 0.00000125);
  assert.equal(Number(gpt5.outputPrice), 0.00001);

  const ds = items.find((i) => i.externalId === "deepseek-chat");
  assert.ok(ds);
  assert.equal(ds.vendorSlugHint, "deepseek");
  assert.equal(Number(ds.inputPrice), 0.00000027);
});

test("parseHuggingFacePayload enforces official org whitelist and rejects community mirrors", () => {
  const payload = [
    { id: "Qwen/Qwen3-235B-A22B", createdAt: "2025-04-28T16:00:00.000Z", pipeline_tag: "text-generation" },
    { id: "deepseek-ai/DeepSeek-R1", createdAt: "2025-01-20T00:00:00.000Z", pipeline_tag: "text-generation" },
    { id: "bartowski/Qwen3-235B-A22B-GGUF", createdAt: "2025-04-29T00:00:00.000Z", pipeline_tag: "text-generation" },
    { id: "random-user/DeepSeek-R1-Distill", createdAt: "2025-01-21T00:00:00.000Z", pipeline_tag: "text-generation" },
  ];

  const items = parseHuggingFacePayload(payload, ["Qwen", "deepseek-ai"]);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => `${i.vendorSlugHint}:${i.externalId}`),
    ["qwen:Qwen/Qwen3-235B-A22B", "deepseek:deepseek-ai/DeepSeek-R1"],
  );
  assert.equal(items[0].sourceNamespace, "hf");
});

test("parseEpochDate and parseEpochCsv preserve date precision without fabricating day 1 as day precision", () => {
  assert.deepEqual(parseEpochDate("2025-02-27"), { date: "2025-02-27", precision: "day" });
  assert.deepEqual(parseEpochDate("2025-03"), { date: "2025-03-01", precision: "month" });
  assert.deepEqual(parseEpochDate("TBD"), { date: null, precision: "unknown" });

  const csv = [
    'Model,Organization,"Publication date",Parameters,Link',
    'Claude 3.7 Sonnet,Anthropic,2025-02-24,,https://www.anthropic.com/news/claude-3-7-sonnet',
    '"Gemini 2.5 Pro",Google DeepMind,2025-03,,https://blog.google/technology/google-deepmind/gemini-model-thinking-updates-march-2025/',
    'Unknown Model,Random Lab,Unknown,,https://example.com',
  ].join("\n");

  const rows = parseEpochCsv(csv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].vendorSlugHint, "anthropic");
  assert.equal(rows[0].historicalDate?.precision, "day");
  assert.equal(rows[0].historicalDate?.date, "2025-02-24");
  assert.equal(rows[1].vendorSlugHint, "google");
  assert.equal(rows[1].historicalDate?.precision, "month");
  assert.equal(rows[1].historicalDate?.date, "2025-03-01");
  assert.equal(rows[2].vendorSlugHint, null);
  assert.equal(rows[2].historicalDate?.precision, "unknown");
  assert.equal(rows[2].historicalDate?.date, null);
});

test("parseArtificialAnalysisPayload parses real v2 /language/models/free nested performance and agentic metrics", () => {
  const realV2Fixture = {
    data: [
      {
        id: "0081ab31-d10a-44a0-a10d-eee5533fec65",
        name: "GLM-4.5V (Non-reasoning)",
        slug: "glm-4-5v",
        release_date: "2025-08-11",
        model_creator: { id: "67437eb6", name: "Z AI" },
        evaluations: {
          artificial_analysis_intelligence_index: 61.2,
          artificial_analysis_coding_index: 66.8,
          artificial_analysis_agentic_index: 59.4,
        },
        pricing: { price_1m_input_tokens: 0.6, price_1m_output_tokens: 1.8 },
        performance: { median_output_tokens_per_second: 41.1, median_time_to_first_token_seconds: 3.76 },
        performance_v3: { mean_output_tokens_per_second: 35.76 },
      },
    ],
  };

  const snapshots = parseArtificialAnalysisPayload(realV2Fixture);
  assert.equal(snapshots.length, 4);
  const byCat = Object.fromEntries(snapshots.map((s) => [s.category, s]));
  assert.equal(byCat.general.entries[0].score, 61.2);
  assert.equal(byCat.coding.entries[0].score, 66.8);
  assert.equal(byCat.reasoning.entries[0].score, 59.4);
  assert.equal(byCat.speed_price.entries[0].score, 41.1);
  assert.equal(byCat.speed_price.unit, "tok/s");
  assert.match(byCat.general.attributionText, /Artificial Analysis/i);
});

test("isOfficialVendorUrl and classifyOfficialAnnouncement enforce domain allowlist and deterministic extraction", () => {
  assert.equal(isOfficialVendorUrl("https://www.anthropic.com/news/claude-4", ["anthropic.com"]), true);
  assert.equal(isOfficialVendorUrl("https://docs.anthropic.com/en/release-notes", ["anthropic.com"]), true);
  assert.equal(isOfficialVendorUrl("https://evil-anthropic.com/news/claude-4", ["anthropic.com"]), false);
  assert.equal(isOfficialVendorUrl("https://medium.com/@someone/claude-4", ["anthropic.com"]), false);
  assert.equal(isOfficialVendorUrl("javascript:alert(1)", ["anthropic.com"]), false);

  const rel = classifyOfficialAnnouncement("Introducing Claude Sonnet 4", "Available today via API.");
  assert.ok(rel);
  assert.equal(rel.eventType, "model_release");
  assert.equal(rel.eventStatus, "released");
  assert.match(rel.modelName ?? "", /Claude Sonnet 4/i);

  const dep = classifyOfficialAnnouncement("Deprecating GPT-4.5 preview in the API", null);
  assert.ok(dep);
  assert.equal(dep.eventType, "deprecation");
  assert.equal(dep.eventStatus, "deprecated");

  assert.equal(classifyOfficialAnnouncement("Our company culture and hiring values", "Join us."), null);
});

test("validateLlmExtraction enforces TypeBox schema and grounded reference IDs", () => {
  const allowedRefs = new Set(["ref-official-1", "ref-registry-2"]);

  const valid = validateLlmExtraction(
    {
      vendor: "Anthropic",
      official_model_name: "Claude Sonnet 4",
      official_model_id: "claude-sonnet-4-20250514",
      event_type: "model_release",
      announced_on: "2025-05-22",
      available_from: "2025-05-22",
      summary_zh: "Anthropic 正式发布 Claude Sonnet 4。",
      key_changes: ["Coding and reasoning improvements"],
      use_cases: ["Software engineering"],
      evidence: [
        {
          field: "announced_on",
          source_reference_id: "ref-official-1",
          excerpt: "Introducing Claude 4 on May 22, 2025.",
          claim: "Announced on 2025-05-22",
        },
      ],
      insufficient_evidence: false,
    },
    allowedRefs,
  );
  assert.equal(valid.ok, true);

  const ungrounded = validateLlmExtraction(
    {
      vendor: "Anthropic",
      official_model_name: "Claude Sonnet 4",
      official_model_id: "claude-sonnet-4-20250514",
      event_type: "model_release",
      announced_on: "2025-05-22",
      available_from: "2025-05-22",
      summary_zh: "Anthropic 正式发布 Claude Sonnet 4。",
      key_changes: [],
      use_cases: [],
      evidence: [
        {
          field: "announced_on",
          source_reference_id: "ref-hallucinated-999",
          excerpt: "Fake excerpt",
          claim: "Fake claim",
        },
      ],
      insufficient_evidence: false,
    },
    allowedRefs,
  );
  assert.equal(ungrounded.ok, false);

  const invalidSchema = validateLlmExtraction(
    {
      vendor: "OpenAI",
      event_type: "rumor_leak",
      evidence: [],
    },
    allowedRefs,
  );
  assert.equal(invalidSchema.ok, false);
});
