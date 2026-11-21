import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildModelSlug,
  canonicalEventKey,
  canonicalizeSourceUrl,
  canonicalModelKey,
  normalizeOfficialModelName,
  normalizeVendorSlug,
} from "../../src/modules/content/ai-event-identity";
import {
  isSuspectedEpochPaddingDate,
  validateHistoryDatasetDir,
} from "../../src/modules/content/ai-history-schema";

test("ai-event-identity normalizes vendor slugs, model names, URLs, and produces shared dedupe_key", () => {
  assert.equal(normalizeVendorSlug("google-deepmind"), "google");
  assert.equal(normalizeVendorSlug("meta-llama"), "meta");
  assert.equal(normalizeVendorSlug("deepseek-ai"), "deepseek");
  assert.equal(normalizeVendorSlug("THUDM"), "zai");

  assert.equal(normalizeOfficialModelName("Claude Sonnet 4.5"), "claude-sonnet-4.5");
  assert.equal(normalizeOfficialModelName("GPT-4o mini"), "gpt-4o-mini");
  assert.notEqual(normalizeOfficialModelName("GPT-4o"), normalizeOfficialModelName("GPT-4o mini"));

  assert.equal(canonicalModelKey("google-deepmind", "Gemini 2.5 Pro"), "google:gemini-2.5-pro");
  assert.equal(buildModelSlug("openai", "GPT-5"), "openai-gpt-5");

  const k1 = canonicalEventKey({
    vendorSlug: "openai",
    eventType: "model_release",
    modelNameOrTitle: "GPT-5",
    date: "2025-08-07",
  });
  const k2 = canonicalEventKey({
    vendorSlug: "OpenAI",
    eventType: "model_release",
    modelNameOrTitle: "gpt-5 ",
    date: "2025-08-07",
  });
  assert.equal(k1, k2);
  assert.ok(k1.startsWith("official:openai:"));

  const kOtherType = canonicalEventKey({
    vendorSlug: "openai",
    eventType: "api_release",
    modelNameOrTitle: "GPT-5",
    date: "2025-08-07",
  });
  assert.notEqual(k1, kOtherType);

  assert.equal(
    canonicalizeSourceUrl("https://OpenAI.com/index/gpt-5/?utm_source=twitter&ref=hn#top"),
    "https://openai.com/index/gpt-5",
  );
});

test("isSuspectedEpochPaddingDate flags YYYY-MM-15 and YYYY-07-01 conservatively", () => {
  assert.equal(isSuspectedEpochPaddingDate("2025-05-15"), true);
  assert.equal(isSuspectedEpochPaddingDate("2025-07-01"), true);
  assert.equal(isSuspectedEpochPaddingDate("2025-08-07"), false);
  assert.equal(isSuspectedEpochPaddingDate(null), false);
});

test("validateHistoryDatasetDir validates hashes, cross-references, and month precision", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ai-history-ds-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });

  const vendors = [
    {
      slug: "openai",
      name: "OpenAI",
      websiteUrl: "https://openai.com",
      officialDomains: ["openai.com"],
    },
  ];
  const references = [
    {
      referenceId: "ref-openai-1",
      url: "https://openai.com/index/gpt-5",
      vendorSlug: "openai",
      kind: "official",
      title: "Introducing GPT-5",
      articlePublishedOn: "2025-08-07",
      verifiedAt: "2026-11-22T00:00:00Z",
      evidenceFor: ["model", "release"],
    },
  ];
  const models = [
    {
      canonicalKey: "openai:gpt-5",
      vendorSlug: "openai",
      officialName: "GPT-5",
      family: "GPT",
      kind: "llm",
      lifecycle: "active",
      sourceReferenceIds: ["ref-openai-1"],
    },
  ];
  const aliases = [
    {
      canonicalModelKey: "openai:gpt-5",
      sourceNamespace: "official",
      alias: "gpt-5",
      reviewStatus: "verified",
      evidenceReferenceIds: ["ref-openai-1"],
    },
  ];
  const releases = [
    {
      sourceEventKey: canonicalEventKey({
        vendorSlug: "openai",
        eventType: "model_release",
        modelNameOrTitle: "GPT-5",
        date: "2025-08-07",
      }),
      vendorSlug: "openai",
      canonicalModelKey: "openai:gpt-5",
      eventType: "model_release",
      eventStatus: "released",
      title: "OpenAI releases GPT-5",
      date: { value: "2025-08-07", precision: "day", semantics: "announcement" },
      sourceReferenceIds: ["ref-openai-1"],
      verification: {
        status: "verified",
        checkedAt: "2026-11-22T00:00:00Z",
        method: "official_article_verified",
      },
    },
  ];

  const filesMeta = [];
  for (const [name, data] of [
    ["vendors.json", vendors],
    ["models.json", models],
    ["aliases.json", aliases],
    ["releases.json", releases],
    ["references.json", references],
  ] as const) {
    const content = JSON.stringify(data, null, 2) + "\n";
    writeFileSync(path.join(dir, name), content);
    filesMeta.push({
      path: name,
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  const manifest = {
    datasetVersion: "v1",
    schemaVersion: 1,
    generatedAt: "2026-11-22T00:00:00Z",
    verifiedThrough: "2026-11-22",
    entries: { vendors: 1, models: 1, aliases: 1, releases: 1, references: 1 },
    files: filesMeta,
    sourcesAttribution: ["Official vendor announcements"],
    license: "Fact metadata only",
    redistributionAllowed: true,
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const validRes = validateHistoryDatasetDir(dir);
  assert.equal(validRes.valid, true, validRes.errors.join("; "));

  // Tamper releases.json -> must fail SHA-256 check
  writeFileSync(path.join(dir, "releases.json"), JSON.stringify(releases) + " ");
  const tamperedRes = validateHistoryDatasetDir(dir);
  assert.equal(tamperedRes.valid, false);
  assert.ok(tamperedRes.errors.some((e) => e.includes("mismatch")));
});
