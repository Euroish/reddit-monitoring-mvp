import type { Pool } from "pg";
import { fail } from "../../storage/db";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VENDOR_COLORS: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  google: "#4285f4",
  meta: "#0668e1",
  deepseek: "#4d6bfe",
  qwen: "#615ced",
  moonshot: "#1a1a1a",
  zai: "#2563eb",
  mistral: "#f59e0b",
  xai: "#111827",
};

export async function listAiVendors(pool: Pool) {
  const res = await pool.query<{
    id: string;
    slug: string;
    name: string;
    officialSite: string;
    logoUrl: string | null;
    sortOrder: number;
    modelCount: number;
    eventCount: number;
  }>(
    `SELECT v.id, v.slug, v.name, v.website_url AS "officialSite",
            v.logo_url AS "logoUrl", v.display_order AS "sortOrder",
            (SELECT COUNT(*)::int FROM ai_model m WHERE m.vendor_id = v.id) AS "modelCount",
            (SELECT COUNT(*)::int FROM ai_release_event e WHERE e.vendor_id = v.id AND e.publication_status = 'published') AS "eventCount"
     FROM ai_vendor v
     ORDER BY v.display_order ASC, v.name ASC`,
  );
  return res.rows.map((v) => ({
    ...v,
    country: null,
    blogUrl: null,
    changelogUrl: null,
    docsUrl: null,
    brandColor: VENDOR_COLORS[v.slug] ?? "#009f81",
    active: true,
  }));
}

export async function listAiModels(
  pool: Pool,
  query: { vendor?: string; q?: string; status?: string; limit?: number; offset?: number },
) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.vendor) {
    params.push(query.vendor);
    where.push(`v.slug = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    where.push(`m.lifecycle_state = $${params.length}`);
  }
  if (query.q?.trim()) {
    params.push(`%${query.q.trim()}%`);
    where.push(`(m.official_name ILIKE $${params.length} OR m.slug ILIKE $${params.length} OR COALESCE(m.family,'') ILIKE $${params.length})`);
  }
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const offset = Math.max(0, query.offset ?? 0);
  params.push(limit, offset);
  const res = await pool.query(
    `SELECT m.id, m.vendor_id AS "vendorId", v.slug AS "vendorSlug", v.name AS "vendorName",
            m.slug AS "canonicalSlug", m.official_name AS "displayName",
            m.family, m.official_api_id AS "officialApiId", m.model_kind AS "modelKind",
            m.lifecycle_state AS "lifecycleStatus", m.open_weights AS "isOpenWeights",
            m.license_name AS "licenseName", m.context_window AS "contextWindow",
            m.summary_zh AS "summaryZh", m.summary_en AS "summaryEn"
     FROM ai_model m
     JOIN ai_vendor v ON v.id = m.vendor_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY m.updated_at DESC, m.official_name ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return res.rows;
}

export async function getAiModelDetail(pool: Pool, idOrSlug: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  const res = await pool.query(
    `SELECT m.id, m.vendor_id AS "vendorId", v.slug AS "vendorSlug", v.name AS "vendorName",
            m.slug AS "canonicalSlug", m.official_name AS "displayName",
            m.family, m.official_api_id AS "officialApiId", m.model_kind AS "modelKind",
            m.lifecycle_state AS "lifecycleStatus", m.open_weights AS "isOpenWeights",
            m.license_name AS "licenseName", m.context_window AS "contextWindow",
            m.summary_zh AS "summaryZh", m.summary_en AS "summaryEn"
     FROM ai_model m JOIN ai_vendor v ON v.id = m.vendor_id
     WHERE ${isUuid ? "m.id = $1::uuid" : "m.slug = $1"}
     LIMIT 1`,
    [idOrSlug],
  );
  const model = res.rows[0];
  if (!model) fail(404, "AI model not found");

  const [aliases, events, specs] = await Promise.all([
    pool.query(
      `SELECT id, source_namespace AS "sourceNamespace", alias, review_status AS "reviewStatus"
       FROM ai_model_alias WHERE model_id = $1 AND review_status = 'verified' ORDER BY source_namespace, alias`,
      [model.id],
    ),
    pool.query(
      `SELECT id, event_type AS "eventType", event_status AS "eventStatus", title,
              event_date::text AS "eventDate", date_precision AS "datePrecision",
              official_announced_on::text AS "officialAnnouncedOn", available_from::text AS "availableFrom",
              summary_zh AS "summaryZh", summary_en AS "summaryEn", source_tier AS "sourceTier"
       FROM ai_release_event WHERE model_id = $1 AND publication_status = 'published'
       ORDER BY event_date DESC, created_at DESC`,
      [model.id],
    ),
    pool.query(
      `SELECT id, source_kind AS "sourceNamespace", observed_at AS "observedAt",
              context_length AS "contextLength", max_output_tokens AS "maxOutputTokens",
              input_modalities AS "inputModalities", output_modalities AS "outputModalities",
              currency, price_unit AS "priceUnit", input_price::text AS "inputPrice",
              output_price::text AS "outputPrice", cache_read_price::text AS "cacheReadPrice",
              raw_unit_note AS "rawUnitNote", provider_name AS "providerName"
       FROM ai_model_spec_observation WHERE model_id = $1
       ORDER BY observed_at DESC LIMIT 12`,
      [model.id],
    ),
  ]);
  return {
    ...model,
    vendorColor: VENDOR_COLORS[model.vendorSlug] ?? "#009f81",
    aliases: aliases.rows,
    events: events.rows,
    specs: specs.rows,
  };
}

export async function listAiEvents(
  pool: Pool,
  query: {
    vendor?: string;
    eventType?: string;
    status?: string;
    from?: string;
    to?: string;
    q?: string;
    limit?: number;
    offset?: number;
  },
) {
  const params: unknown[] = [];
  const where: string[] = [`e.publication_status = 'published'`];
  if (query.vendor) {
    const slugs = query.vendor.split(",").map((s) => s.trim()).filter(Boolean);
    if (slugs.length) {
      params.push(slugs);
      where.push(`v.slug = ANY($${params.length}::text[])`);
    }
  }
  if (query.eventType) {
    params.push(query.eventType);
    where.push(`e.event_type = $${params.length}`);
  }
  if (query.status) {
    params.push(query.status);
    where.push(`e.event_status = $${params.length}`);
  }
  if (query.from && ISO_DATE_RE.test(query.from)) {
    params.push(query.from);
    where.push(`e.event_date >= $${params.length}::date`);
  }
  if (query.to && ISO_DATE_RE.test(query.to)) {
    params.push(query.to);
    where.push(`e.event_date <= $${params.length}::date`);
  }
  if (query.q?.trim()) {
    params.push(`%${query.q.trim()}%`);
    where.push(`(e.title ILIKE $${params.length} OR COALESCE(e.summary_zh,'') ILIKE $${params.length} OR COALESCE(e.summary_en,'') ILIKE $${params.length} OR COALESCE(m.official_name,'') ILIKE $${params.length})`);
  }
  const limit = Math.min(200, Math.max(1, query.limit ?? 120));
  const offset = Math.max(0, query.offset ?? 0);
  params.push(limit, offset);

  const res = await pool.query(
    `SELECT e.id, e.vendor_id AS "vendorId", v.slug AS "vendorSlug", v.name AS "vendorName",
            e.model_id AS "modelId", m.slug AS "modelSlug", m.official_name AS "modelName",
            e.event_type AS "eventType", e.event_status AS "eventStatus",
            e.title, e.event_date::text AS "eventDate", e.date_precision AS "datePrecision",
            e.official_announced_on::text AS "officialAnnouncedOn",
            e.available_from::text AS "availableFrom", e.effective_on::text AS "effectiveOn",
            e.summary_zh AS "summaryZh", e.summary_en AS "summaryEn",
            e.key_changes AS "keyChanges", e.source_tier AS "sourceTier",
            e.publication_status AS "visibility", e.verified_at AS "publishedAt",
            (SELECT json_agg(json_build_object(
              'id', r.id,
              'role', CASE WHEN r.is_primary THEN 'primary' ELSE 'secondary' END,
              'title', r.title, 'url', r.url,
              'contentId', r.content_id, 'sourceTier', r.source_kind, 'excerpt', r.excerpt
            ) ORDER BY r.is_primary DESC, r.created_at ASC)
             FROM ai_event_reference r WHERE r.event_id = e.id) AS references
     FROM ai_release_event e
     JOIN ai_vendor v ON v.id = e.vendor_id
     LEFT JOIN ai_model m ON m.id = e.model_id
     WHERE ${where.join(" AND ")}
     ORDER BY e.event_date DESC, e.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    ...r,
    vendorColor: VENDOR_COLORS[r.vendorSlug] ?? "#009f81",
    references: r.references ?? [],
  }));
}

export async function getAiEventDetail(pool: Pool, id: string) {
  const res = await pool.query(
    `SELECT e.id, e.vendor_id AS "vendorId", v.slug AS "vendorSlug", v.name AS "vendorName",
            v.website_url AS "vendorSite",
            e.model_id AS "modelId", m.slug AS "modelSlug", m.official_name AS "modelName",
            m.family AS "modelFamily", m.lifecycle_state AS "modelLifecycleStatus",
            e.event_type AS "eventType", e.event_status AS "eventStatus",
            e.title, e.event_date::text AS "eventDate", e.date_precision AS "datePrecision",
            e.official_announced_on::text AS "officialAnnouncedOn",
            e.available_from::text AS "availableFrom", e.effective_on::text AS "effectiveOn",
            e.summary_zh AS "summaryZh", e.summary_en AS "summaryEn",
            e.key_changes AS "keyChanges", e.source_tier AS "sourceTier",
            e.publication_status AS "visibility", e.verified_at AS "publishedAt"
     FROM ai_release_event e
     JOIN ai_vendor v ON v.id = e.vendor_id
     LEFT JOIN ai_model m ON m.id = e.model_id
     WHERE e.id = $1::uuid AND e.publication_status = 'published'
     LIMIT 1`,
    [id],
  );
  const ev = res.rows[0];
  if (!ev) fail(404, "AI release event not found");

  const [refs, versionChain, specs] = await Promise.all([
    pool.query(
      `SELECT id, CASE WHEN is_primary THEN 'primary' ELSE 'secondary' END AS role,
              title, url, content_id AS "contentId", source_kind AS "sourceTier",
              excerpt, created_at AS "capturedAt"
       FROM ai_event_reference WHERE event_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [ev.id],
    ),
    ev.modelId
      ? pool.query(
          `SELECT id, event_type AS "eventType", event_status AS "eventStatus", title,
                  event_date::text AS "eventDate", date_precision AS "datePrecision"
           FROM ai_release_event
           WHERE model_id = $1 AND publication_status = 'published'
           ORDER BY event_date ASC, created_at ASC`,
          [ev.modelId],
        )
      : Promise.resolve({ rows: [] }),
    ev.modelId
      ? pool.query(
          `SELECT id, source_kind AS "sourceNamespace", observed_at AS "observedAt",
                  context_length AS "contextLength", max_output_tokens AS "maxOutputTokens",
                  input_modalities AS "inputModalities", output_modalities AS "outputModalities",
                  currency, price_unit AS "priceUnit", input_price::text AS "inputPrice",
                  output_price::text AS "outputPrice", cache_read_price::text AS "cacheReadPrice",
                  raw_unit_note AS "rawUnitNote", provider_name AS "providerName"
           FROM ai_model_spec_observation WHERE model_id = $1
           ORDER BY observed_at DESC LIMIT 6`,
          [ev.modelId],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  return {
    ...ev,
    vendorColor: VENDOR_COLORS[ev.vendorSlug] ?? "#009f81",
    references: refs.rows,
    versionChain: versionChain.rows,
    specs: specs.rows,
  };
}

export async function listAiOfficialUpdates(
  pool: Pool,
  query: { vendor?: string; limit?: number; offset?: number },
) {
  const params: unknown[] = [];
  const where: string[] = [`(cs.source_group = 'ai-firsthand' OR avs.vendor_id IS NOT NULL)`];
  if (query.vendor) {
    params.push(query.vendor);
    where.push(`v.slug = $${params.length}`);
  }
  const limit = Math.min(60, Math.max(1, query.limit ?? 24));
  const offset = Math.max(0, query.offset ?? 0);

  const res = await pool.query(
    `SELECT DISTINCT ON (c.id)
            c.id AS "contentId", c.title, COALESCE(c.permalink, c.url) AS url, c.body_text AS "bodyText",
            COALESCE(c.created_at_source, d.first_fetched_at) AS "publishedAt", cs.label AS "sourceName",
            cs.source_group AS "sourceGroup", cs.tier AS "sourceTier",
            v.slug AS "vendorSlug", v.name AS "vendorName",
            (SELECT json_agg(json_build_object('id', e.id, 'title', e.title, 'eventDate', e.event_date::text))
             FROM ai_event_reference r
             JOIN ai_release_event e ON e.id = r.event_id AND e.publication_status = 'published'
             WHERE r.content_id = c.id) AS "linkedEvents"
     FROM content c
     JOIN content_discovery d ON d.content_id = c.id
     JOIN collection_source cs ON cs.id = d.collection_source_id
     LEFT JOIN ai_vendor_source avs ON avs.source_id = cs.id
     LEFT JOIN ai_vendor v ON v.id = avs.vendor_id
     WHERE ${where.join(" AND ")} AND c.title IS NOT NULL
     ORDER BY c.id, COALESCE(c.created_at_source, d.first_fetched_at) DESC NULLS LAST`,
    params,
  );
  return res.rows
    .sort((a, b) => String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")))
    .slice(offset, offset + limit)
    .map((r) => ({
      contentId: r.contentId,
      title: r.title,
      url: r.url,
      summary: typeof r.bodyText === "string" ? r.bodyText.slice(0, 260) : null,
      publishedAt: r.publishedAt,
      sourceName: r.sourceName,
      sourceTier: r.sourceTier,
      vendorSlug: r.vendorSlug,
      vendorName: r.vendorName,
      vendorColor: r.vendorSlug ? (VENDOR_COLORS[r.vendorSlug] ?? "#009f81") : "#009f81",
      linkedEvents: r.linkedEvents ?? [],
    }));
}

export async function listAiRankings(pool: Pool, category?: string) {
  const params: unknown[] = [];
  const where = category ? (params.push(category), `WHERE s.category = $1`) : "";
  const snaps = await pool.query(
    `SELECT DISTINCT ON (s.category, s.metric_name)
            s.id, s.provider_code AS "providerCode", s.category,
            s.metric_name AS "metricName", s.metric_version AS "metricVersion",
            s.metric_direction AS "metricDirection", s.unit,
            s.captured_at AS "capturedAt", s.attribution_text AS "attributionText",
            s.attribution_url AS "attributionUrl"
     FROM ai_benchmark_snapshot s
     ${where}
     ORDER BY s.category, s.metric_name, s.captured_at DESC`,
    params,
  );
  const out = [];
  for (const snap of snaps.rows) {
    const entries = await pool.query(
      `SELECT e.id, e.external_model_id AS "externalModelId", e.model_id AS "modelId",
              e.model_name AS "modelName", e.vendor_name AS "vendorName",
              e.score::float AS score, e.rank, e.provider_setting AS "providerSetting"
       FROM ai_benchmark_entry e WHERE e.snapshot_id = $1 ORDER BY e.rank ASC LIMIT 30`,
      [snap.id],
    );
    out.push({ ...snap, entries: entries.rows });
  }
  return out;
}

export async function getAiRankingDetail(pool: Pool, id: string) {
  const snap = await pool.query(
    `SELECT id, provider_code AS "providerCode", category,
            metric_name AS "metricName", metric_version AS "metricVersion",
            metric_direction AS "metricDirection", unit,
            captured_at AS "capturedAt", attribution_text AS "attributionText",
            attribution_url AS "attributionUrl"
     FROM ai_benchmark_snapshot WHERE id = $1::uuid LIMIT 1`,
    [id],
  );
  if (!snap.rows[0]) fail(404, "Benchmark snapshot not found");
  const entries = await pool.query(
    `SELECT id, external_model_id AS "externalModelId", model_id AS "modelId",
            model_name AS "modelName", vendor_name AS "vendorName",
            score::float AS score, rank, provider_setting AS "providerSetting"
     FROM ai_benchmark_entry WHERE snapshot_id = $1 ORDER BY rank ASC`,
    [id],
  );
  return { ...snap.rows[0], entries: entries.rows };
}
