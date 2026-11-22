import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { Type, type Static } from "@sinclair/typebox";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

export const HistoryVendorSchema = Type.Object({
  slug: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,47}$" }),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  websiteUrl: Type.String({ format: "uri", maxLength: 512 }),
  officialDomains: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1 }),
  officialOrgs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
  displayOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
}, { additionalProperties: false });

export const HistoryModelSchema = Type.Object({
  canonicalKey: Type.String({ minLength: 3, maxLength: 160 }),
  vendorSlug: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,47}$" }),
  officialName: Type.String({ minLength: 1, maxLength: 160 }),
  family: Type.String({ minLength: 1, maxLength: 120 }),
  officialApiId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  kind: Type.Union([
    Type.Literal("llm"),
    Type.Literal("reasoning"),
    Type.Literal("multimodal"),
    Type.Literal("image"),
    Type.Literal("video"),
    Type.Literal("audio"),
    Type.Literal("embedding"),
    Type.Literal("code"),
    Type.Literal("other"),
  ]),
  lifecycle: Type.Union([
    Type.Literal("announced"),
    Type.Literal("preview"),
    Type.Literal("active"),
    Type.Literal("deprecated"),
    Type.Literal("retired"),
    Type.Literal("unknown"),
  ]),
  openWeights: Type.Optional(Type.Boolean()),
  licenseName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  modalities: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 40 }))),
  contextWindow: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000_000 })),
  summaryZh: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  summaryEn: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  sourceReferenceIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1 }),
}, { additionalProperties: false });

export const HistoryAliasSchema = Type.Object({
  canonicalModelKey: Type.String({ minLength: 3, maxLength: 160 }),
  sourceNamespace: Type.Union([
    Type.Literal("official"),
    Type.Literal("openrouter"),
    Type.Literal("litellm"),
    Type.Literal("hf"),
    Type.Literal("epoch"),
    Type.Literal("artificial_analysis"),
    Type.Literal("manual"),
  ]),
  alias: Type.String({ minLength: 1, maxLength: 256 }),
  reviewStatus: Type.Union([Type.Literal("verified"), Type.Literal("pending")]),
  evidenceReferenceIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1 }),
}, { additionalProperties: false });

export const HistoryReleaseSchema = Type.Object({
  sourceEventKey: Type.String({ minLength: 8, maxLength: 256 }),
  vendorSlug: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,47}$" }),
  canonicalModelKey: Type.Optional(Type.String({ minLength: 3, maxLength: 160 })),
  eventType: Type.Union([
    Type.Literal("model_release"),
    Type.Literal("model_update"),
    Type.Literal("api_release"),
    Type.Literal("preview"),
    Type.Literal("ga"),
    Type.Literal("pricing_change"),
    Type.Literal("deprecation"),
    Type.Literal("retirement"),
    Type.Literal("other"),
  ]),
  eventStatus: Type.Union([
    Type.Literal("released"),
    Type.Literal("announced_future"),
    Type.Literal("deprecated"),
    Type.Literal("retired"),
  ]),
  title: Type.String({ minLength: 3, maxLength: 240 }),
  date: Type.Object({
    value: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
    precision: Type.Union([Type.Literal("day"), Type.Literal("month")]),
    semantics: Type.Union([
      Type.Literal("announcement"),
      Type.Literal("api_available"),
      Type.Literal("general_availability"),
      Type.Literal("deprecation"),
      Type.Literal("retirement"),
      Type.Literal("paper_publication"),
    ]),
  }, { additionalProperties: false }),
  officialAnnouncedOn: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  availableFrom: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  effectiveOn: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  sourceReferenceIds: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1 }),
  summaryZh: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  summaryEn: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  keyChanges: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 10 })),
  verification: Type.Object({
    status: Type.Literal("verified"),
    checkedAt: Type.String({ format: "date-time" }),
    method: Type.Union([
      Type.Literal("official_article_verified"),
      Type.Literal("official_changelog_verified"),
      Type.Literal("official_docs_verified"),
      Type.Literal("official_repo_verified"),
    ]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export const HistoryReferenceSchema = Type.Object({
  referenceId: Type.String({ minLength: 1, maxLength: 128 }),
  url: Type.String({ format: "uri", maxLength: 2000 }),
  resolvedUrl: Type.Optional(Type.String({ format: "uri", maxLength: 2000 })),
  vendorSlug: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]{0,47}$" }),
  kind: Type.Union([
    Type.Literal("official"),
    Type.Literal("changelog"),
    Type.Literal("model_card"),
    Type.Literal("epoch"),
    Type.Literal("registry"),
    Type.Literal("other"),
  ]),
  title: Type.String({ minLength: 1, maxLength: 300 }),
  articlePublishedOn: Type.Optional(Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" })),
  verifiedAt: Type.String({ format: "date-time" }),
  evidenceFor: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { minItems: 1 }),
  locator: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
  licenseNote: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
}, { additionalProperties: false });

export const HistoryManifestSchema = Type.Object({
  datasetVersion: Type.String({ pattern: "^v[0-9]+$" }),
  schemaVersion: Type.Integer({ minimum: 1 }),
  generatedAt: Type.String({ format: "date-time" }),
  verifiedThrough: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
  entries: Type.Object({
    vendors: Type.Integer({ minimum: 0 }),
    models: Type.Integer({ minimum: 0 }),
    aliases: Type.Integer({ minimum: 0 }),
    releases: Type.Integer({ minimum: 0 }),
    references: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false }),
  files: Type.Array(Type.Object({
    path: Type.String({ pattern: "^[a-z0-9_-]+\\.json$" }),
    bytes: Type.Integer({ minimum: 2 }),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  }, { additionalProperties: false }), { minItems: 5 }),
  sourcesAttribution: Type.Array(Type.String({ minLength: 1, maxLength: 300 })),
  license: Type.String({ minLength: 1, maxLength: 200 }),
  redistributionAllowed: Type.Boolean(),
}, { additionalProperties: false });

export type HistoryVendor = Static<typeof HistoryVendorSchema>;
export type HistoryModel = Static<typeof HistoryModelSchema>;
export type HistoryAlias = Static<typeof HistoryAliasSchema>;
export type HistoryRelease = Static<typeof HistoryReleaseSchema>;
export type HistoryReference = Static<typeof HistoryReferenceSchema>;
export type HistoryManifest = Static<typeof HistoryManifestSchema>;

export interface LoadedHistoryDataset {
  manifest: HistoryManifest;
  manifestSha256: string;
  vendors: HistoryVendor[];
  models: HistoryModel[];
  aliases: HistoryAlias[];
  releases: HistoryRelease[];
  references: HistoryReference[];
}

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validateVendorsFn = ajv.compile(Type.Array(HistoryVendorSchema));
const validateModelsFn = ajv.compile(Type.Array(HistoryModelSchema));
const validateAliasesFn = ajv.compile(Type.Array(HistoryAliasSchema));
const validateReleasesFn = ajv.compile(Type.Array(HistoryReleaseSchema));
const validateReferencesFn = ajv.compile(Type.Array(HistoryReferenceSchema));
const validateManifestFn = ajv.compile(HistoryManifestSchema);

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function isValidCalendarDate(dateStr: string): boolean {
  if (!ISO_DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Epoch AI fills missing day as 15th and missing month-day as July 1st.
 * Returns true if a date matches those placeholder patterns so callers flag it as suspected padding
 * rather than treating it as an exact official release day.
 */
export function isSuspectedEpochPaddingDate(dateStr: string | null | undefined): boolean {
  if (!dateStr || !ISO_DATE_RE.test(dateStr)) return false;
  return dateStr.endsWith("-15") || dateStr.endsWith("-07-01");
}

function assertValid(fn: ReturnType<typeof ajv.compile>, data: unknown, label: string, errors: string[]): void {
  if (!fn(data)) {
    const msgs = (fn.errors ?? []).slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
    errors.push(`${label} schema validation failed: ${msgs.join("; ")}`);
  }
}

/**
 * Offline validation of a versioned AI history dataset directory.
 * Checks manifest schema, file SHA-256 hashes, TypeBox schemas, dates, and cross-references.
 */
export function validateHistoryDatasetDir(dirPath: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  dataset: LoadedHistoryDataset | null;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const manifestPath = join(dirPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    return { valid: false, errors: [`Missing manifest.json in ${dirPath}`], warnings, dataset: null };
  }
  const manifestBuf = readFileSync(manifestPath);
  const manifestSha256 = sha256Buffer(manifestBuf);
  let manifest: HistoryManifest;
  try {
    manifest = JSON.parse(manifestBuf.toString("utf8")) as HistoryManifest;
  } catch (err) {
    return { valid: false, errors: [`Invalid JSON in manifest.json: ${String(err)}`], warnings, dataset: null };
  }
  assertValid(validateManifestFn, manifest, "manifest.json", errors);
  if (errors.length > 0) return { valid: false, errors, warnings, dataset: null };

  const requiredFiles = ["vendors.json", "models.json", "aliases.json", "releases.json", "references.json"];
  const fileData: Record<string, unknown> = {};
  for (const name of requiredFiles) {
    const entry = manifest.files.find((f) => f.path === name);
    if (!entry) {
      errors.push(`manifest.json missing file entry for ${name}`);
      continue;
    }
    const full = join(dirPath, name);
    if (!existsSync(full)) {
      errors.push(`Missing dataset file: ${name}`);
      continue;
    }
    const buf = readFileSync(full);
    const actualSize = statSync(full).size;
    const actualHash = sha256Buffer(buf);
    if (actualSize !== entry.bytes) {
      errors.push(`Byte size mismatch for ${name}: expected ${entry.bytes}, got ${actualSize}`);
    }
    if (!SHA256_RE.test(entry.sha256) || actualHash !== entry.sha256) {
      errors.push(`SHA-256 mismatch for ${name}: expected ${entry.sha256}, got ${actualHash}`);
    }
    try {
      fileData[name] = JSON.parse(buf.toString("utf8"));
    } catch (err) {
      errors.push(`Invalid JSON in ${name}: ${String(err)}`);
    }
  }
  if (errors.length > 0) return { valid: false, errors, warnings, dataset: null };

  assertValid(validateVendorsFn, fileData["vendors.json"], "vendors.json", errors);
  assertValid(validateModelsFn, fileData["models.json"], "models.json", errors);
  assertValid(validateAliasesFn, fileData["aliases.json"], "aliases.json", errors);
  assertValid(validateReleasesFn, fileData["releases.json"], "releases.json", errors);
  assertValid(validateReferencesFn, fileData["references.json"], "references.json", errors);
  if (errors.length > 0) return { valid: false, errors, warnings, dataset: null };

  const vendors = fileData["vendors.json"] as HistoryVendor[];
  const models = fileData["models.json"] as HistoryModel[];
  const aliases = fileData["aliases.json"] as HistoryAlias[];
  const releases = fileData["releases.json"] as HistoryRelease[];
  const references = fileData["references.json"] as HistoryReference[];

  if (manifest.entries.vendors !== vendors.length) errors.push("manifest.entries.vendors count mismatch");
  if (manifest.entries.models !== models.length) errors.push("manifest.entries.models count mismatch");
  if (manifest.entries.aliases !== aliases.length) errors.push("manifest.entries.aliases count mismatch");
  if (manifest.entries.releases !== releases.length) errors.push("manifest.entries.releases count mismatch");
  if (manifest.entries.references !== references.length) errors.push("manifest.entries.references count mismatch");

  const vendorSet = new Set<string>();
  for (const v of vendors) {
    if (vendorSet.has(v.slug)) errors.push(`Duplicate vendor slug: ${v.slug}`);
    vendorSet.add(v.slug);
  }
  const refSet = new Set<string>();
  for (const r of references) {
    if (refSet.has(r.referenceId)) errors.push(`Duplicate referenceId: ${r.referenceId}`);
    refSet.add(r.referenceId);
    if (!vendorSet.has(r.vendorSlug)) errors.push(`Reference ${r.referenceId} unknown vendor ${r.vendorSlug}`);
    if (r.articlePublishedOn && !isValidCalendarDate(r.articlePublishedOn)) {
      errors.push(`Reference ${r.referenceId} invalid articlePublishedOn ${r.articlePublishedOn}`);
    }
    if (!/^https?:\/\//i.test(r.url)) errors.push(`Reference ${r.referenceId} non-http URL`);
  }
  const modelSet = new Set<string>();
  for (const m of models) {
    if (modelSet.has(m.canonicalKey)) errors.push(`Duplicate model canonicalKey: ${m.canonicalKey}`);
    modelSet.add(m.canonicalKey);
    if (!vendorSet.has(m.vendorSlug)) errors.push(`Model ${m.canonicalKey} unknown vendor ${m.vendorSlug}`);
    for (const refId of m.sourceReferenceIds) {
      if (!refSet.has(refId)) errors.push(`Model ${m.canonicalKey} missing reference ${refId}`);
    }
  }
  const aliasPairSet = new Set<string>();
  for (const a of aliases) {
    if (!modelSet.has(a.canonicalModelKey)) errors.push(`Alias ${a.alias} missing model ${a.canonicalModelKey}`);
    const pair = `${a.sourceNamespace}:${a.alias}`;
    if (aliasPairSet.has(pair)) errors.push(`Duplicate alias pair: ${pair}`);
    aliasPairSet.add(pair);
    for (const refId of a.evidenceReferenceIds) {
      if (!refSet.has(refId)) errors.push(`Alias ${a.alias} missing reference ${refId}`);
    }
  }
  const eventKeySet = new Set<string>();
  for (const rel of releases) {
    if (eventKeySet.has(rel.sourceEventKey)) errors.push(`Duplicate sourceEventKey: ${rel.sourceEventKey}`);
    eventKeySet.add(rel.sourceEventKey);
    if (!vendorSet.has(rel.vendorSlug)) errors.push(`Release ${rel.sourceEventKey} unknown vendor ${rel.vendorSlug}`);
    if (rel.canonicalModelKey && !modelSet.has(rel.canonicalModelKey)) {
      errors.push(`Release ${rel.sourceEventKey} missing model ${rel.canonicalModelKey}`);
    }
    if (!isValidCalendarDate(rel.date.value)) {
      errors.push(`Release ${rel.sourceEventKey} invalid date ${rel.date.value}`);
    }
    if (rel.date.precision === "month" && !rel.date.value.endsWith("-01")) {
      errors.push(`Release ${rel.sourceEventKey} month precision must use YYYY-MM-01 placeholder`);
    }
    for (const refId of rel.sourceReferenceIds) {
      if (!refSet.has(refId)) errors.push(`Release ${rel.sourceEventKey} missing reference ${refId}`);
    }
    const hasOfficialRef = rel.sourceReferenceIds.some((id) => {
      const ref = references.find((r) => r.referenceId === id);
      return ref && (ref.kind === "official" || ref.kind === "changelog" || ref.kind === "model_card");
    });
    if (!hasOfficialRef) {
      errors.push(`Release ${rel.sourceEventKey} lacks official/changelog/model_card primary reference`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    dataset: errors.length === 0 ? { manifest, manifestSha256, vendors, models, aliases, releases, references } : null,
  };
}
