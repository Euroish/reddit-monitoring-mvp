import type { Pool } from "pg";
import { fail, transaction } from "../../storage/db";

function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export async function listAiQueue(
  pool: Pool,
  query: { status?: string; vendor?: string; limit?: number; offset?: number },
) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.status) {
    params.push(query.status);
    where.push(`c.status = $${params.length}`);
  }
  if (query.vendor) {
    params.push(query.vendor);
    where.push(`v.slug = $${params.length}`);
  }
  const limit = Math.min(100, Math.max(1, query.limit ?? 50));
  const offset = Math.max(0, query.offset ?? 0);
  params.push(limit, offset);
  const res = await pool.query(
    `SELECT c.id, c.status, c.priority, c.vendor_id AS "vendorId",
            v.slug AS "vendorSlug", v.name AS "vendorName",
            c.model_id AS "modelId", m.official_name AS "modelName",
            c.title, c.suggested_event_type AS "suggestedEventType",
            c.suggested_date::text AS "suggestedDate", c.date_precision AS "datePrecision",
            c.candidate_type AS "candidateType", c.draft_payload AS "draftPayload",
            c.evidence_payload AS "evidencePayload", c.content_id AS "contentId",
            c.published_event_id AS "publishedEventId",
            c.reviewer_note AS "reviewerNote", c.revision,
            c.created_at AS "createdAt", c.updated_at AS "updatedAt"
     FROM ai_event_candidate c
     LEFT JOIN ai_vendor v ON v.id = c.vendor_id
     LEFT JOIN ai_model m ON m.id = c.model_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'needs_info' THEN 1 ELSE 2 END,
              c.priority DESC, c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return res.rows.map((r) => ({
    ...r,
    evidenceSummary: r.candidateType,
    evidenceContentIds: r.contentId ? [r.contentId] : [],
  }));
}

export async function patchAiCandidate(
  pool: Pool,
  id: string,
  body: {
    expectedRevision: number;
    status?: string;
    vendorId?: string | null;
    modelId?: string | null;
    title?: string;
    suggestedEventType?: string;
    suggestedDate?: string | null;
    datePrecision?: string;
    reviewerNote?: string | null;
    draftPayload?: Record<string, unknown>;
  },
) {
  const res = await pool.query(
    `UPDATE ai_event_candidate
     SET status = COALESCE($3, status),
         vendor_id = CASE WHEN $4::boolean THEN $5::uuid ELSE vendor_id END,
         model_id = CASE WHEN $6::boolean THEN $7::uuid ELSE model_id END,
         title = COALESCE($8, title),
         suggested_event_type = COALESCE($9, suggested_event_type),
         suggested_date = CASE WHEN $10::boolean THEN $11::date ELSE suggested_date END,
         date_precision = COALESCE($12, date_precision),
         reviewer_note = CASE WHEN $13::boolean THEN $14 ELSE reviewer_note END,
         draft_payload = COALESCE($15::jsonb, draft_payload),
         revision = revision + 1,
         updated_at = NOW()
     WHERE id = $1::uuid AND revision = $2
     RETURNING id, status, revision, title, updated_at AS "updatedAt"`,
    [
      id,
      body.expectedRevision,
      body.status ?? null,
      body.vendorId !== undefined,
      body.vendorId ?? null,
      body.modelId !== undefined,
      body.modelId ?? null,
      body.title ?? null,
      body.suggestedEventType ?? null,
      body.suggestedDate !== undefined,
      body.suggestedDate ?? null,
      body.datePrecision ?? null,
      body.reviewerNote !== undefined,
      body.reviewerNote ?? null,
      body.draftPayload ? JSON.stringify(body.draftPayload) : null,
    ],
  );
  if (!res.rows[0]) {
    const exists = await pool.query(`SELECT revision FROM ai_event_candidate WHERE id = $1::uuid`, [id]);
    if (!exists.rows[0]) fail(404, "Candidate not found");
    fail(409, `Candidate revision conflict (current revision: ${exists.rows[0].revision})`);
  }
  return res.rows[0];
}

export async function publishAiCandidate(
  pool: Pool,
  id: string,
  reviewerId: string,
  body: {
    expectedRevision: number;
    vendorId: string;
    modelId?: string | null;
    eventType: string;
    eventStatus?: string;
    title: string;
    eventDate: string;
    datePrecision: "day" | "month";
    officialAnnouncedOn?: string | null;
    availableFrom?: string | null;
    effectiveOn?: string | null;
    summaryZh?: string | null;
    summaryEn?: string | null;
    keyChanges?: string[];
    sourceTier?: "official" | "historical_verified" | "manual_verified";
    primaryReferenceUrl: string;
    primaryReferenceTitle?: string;
    createAlias?: { sourceNamespace: string; alias: string };
  },
) {
  if (!isSafeHttpUrl(body.primaryReferenceUrl)) {
    fail(400, "primaryReferenceUrl must be a valid http(s) URL");
  }
  return transaction(pool, async (client) => {
    const cand = await client.query<{ id: string; revision: number; status: string; content_id: string | null }>(
      `SELECT id, revision, status, content_id FROM ai_event_candidate WHERE id = $1::uuid FOR UPDATE`,
      [id],
    );
    if (!cand.rows[0]) fail(404, "Candidate not found");
    if (cand.rows[0].revision !== body.expectedRevision) {
      fail(409, `Candidate revision conflict (current revision: ${cand.rows[0].revision})`);
    }
    const vendorCheck = await client.query(`SELECT id FROM ai_vendor WHERE id = $1::uuid`, [body.vendorId]);
    if (!vendorCheck.rows[0]) fail(400, "Invalid vendorId");

    const evRes = await client.query<{ id: string }>(
      `INSERT INTO ai_release_event (
         vendor_id, model_id, event_type, event_status, publication_status,
         title, event_date, date_precision,
         official_announced_on, available_from, effective_on, summary_zh, summary_en,
         key_changes, source_tier, verified_by, verified_at
       ) VALUES ($1,$2,$3,$4,'published',$5,$6::date,$7,$8::date,$9::date,$10::date,$11,$12,$13::jsonb,$14,$15,NOW())
       RETURNING id`,
      [
        body.vendorId,
        body.modelId ?? null,
        body.eventType,
        body.eventStatus ?? "released",
        body.title.trim(),
        body.eventDate,
        body.datePrecision,
        body.officialAnnouncedOn ?? null,
        body.availableFrom ?? null,
        body.effectiveOn ?? null,
        body.summaryZh ?? null,
        body.summaryEn ?? null,
        JSON.stringify(body.keyChanges ?? []),
        body.sourceTier ?? "official",
        reviewerId,
      ],
    );
    const eventId = evRes.rows[0].id;

    await client.query(
      `INSERT INTO ai_event_reference (event_id, content_id, title, url, source_kind, is_primary, verified_at)
       VALUES ($1, $2, $3, $4, 'official', TRUE, NOW())`,
      [
        eventId,
        cand.rows[0].content_id,
        body.primaryReferenceTitle?.trim() || body.title.trim(),
        body.primaryReferenceUrl,
      ],
    );

    if (body.createAlias && body.modelId) {
      await client.query(
        `INSERT INTO ai_model_alias (model_id, source_namespace, alias, review_status)
         VALUES ($1, $2, $3, 'verified')
         ON CONFLICT (source_namespace, alias) DO UPDATE SET model_id = EXCLUDED.model_id, review_status = 'verified'`,
        [body.modelId, body.createAlias.sourceNamespace, body.createAlias.alias],
      );
    }

    await client.query(
      `UPDATE ai_event_candidate
       SET status = 'approved', published_event_id = $2, reviewed_by = $3, reviewed_at = NOW(),
           revision = revision + 1, updated_at = NOW()
       WHERE id = $1::uuid`,
      [id, eventId, reviewerId],
    );

    return { eventId, candidateId: id, status: "published" };
  });
}

export async function unpublishAiEvent(pool: Pool, eventId: string) {
  const res = await pool.query(
    `UPDATE ai_release_event SET publication_status = 'unpublished', updated_at = NOW()
     WHERE id = $1::uuid RETURNING id, publication_status AS visibility`,
    [eventId],
  );
  if (!res.rows[0]) fail(404, "AI release event not found");
  return res.rows[0];
}
