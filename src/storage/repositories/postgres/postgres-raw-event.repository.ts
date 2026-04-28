import { createHash } from "node:crypto";
import type { RawEnvelope } from "../../../connectors/shared/connector.interface";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";

interface InsertRawEventRow {
  id: string;
}

export class PostgresRawEventRepository implements RawEventRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
    retention?: {
      retainRawPayload?: boolean;
      reason?: string;
    };
  }): Promise<void> {
    const retainRawPayload = shouldRetainRawPayload(event);
    const rawEventId = retainRawPayload
      ? await this.insertRawEvent(event)
      : null;
    const requestParams = event.envelope.requestParams ?? {};
    const payloadSummary = summarizePayload(event.envelope.payload);
    await this.db.query(
      `
      INSERT INTO reddit_fetch_event (
        collection_job_id, target_id, provider, endpoint, listing, time_range,
        http_status, fetched_at, request_limit, returned_count, after_cursor,
        next_cursor, payload_hash, retention_reason, raw_event_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        event.collectionJobId,
        event.targetId,
        resolveProvider(event.envelope.responseHeaders, requestParams.provider),
        event.envelope.endpoint,
        resolveListing(event.envelope.endpoint),
        stringParam(requestParams.t),
        event.envelope.httpStatus,
        event.envelope.fetchedAt,
        numberParam(requestParams.limit),
        payloadSummary.returnedCount,
        stringParam(requestParams.after),
        payloadSummary.nextCursor,
        payloadSummary.payloadHash,
        retainRawPayload ? retentionReason(event) : null,
        rawEventId,
      ],
    );
  }

  private async insertRawEvent<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
  }): Promise<string> {
    const result = await this.db.query<InsertRawEventRow>(
      `
      INSERT INTO raw_reddit_event (
        collection_job_id, target_id, endpoint, request_params, http_status, response_headers, payload, fetched_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8)
      RETURNING id
      `,
      [
        event.collectionJobId,
        event.targetId,
        event.envelope.endpoint,
        JSON.stringify(event.envelope.requestParams ?? {}),
        event.envelope.httpStatus,
        JSON.stringify(event.envelope.responseHeaders ?? {}),
        JSON.stringify(event.envelope.payload ?? {}),
        event.envelope.fetchedAt,
      ],
    );
    return result.rows[0]!.id;
  }
}

function shouldRetainRawPayload<TPayload>(event: {
  envelope: RawEnvelope<TPayload>;
  retention?: {
    retainRawPayload?: boolean;
  };
}): boolean {
  return (
    event.retention?.retainRawPayload === true ||
    event.envelope.httpStatus >= 400 ||
    process.env.RAW_EVENT_RETAIN_FULL_PAYLOAD === "true"
  );
}

function retentionReason<TPayload>(event: {
  envelope: RawEnvelope<TPayload>;
  retention?: {
    reason?: string;
  };
}): string {
  if (event.retention?.reason) {
    return event.retention.reason;
  }
  if (event.envelope.httpStatus >= 400) {
    return "http_error";
  }
  if (process.env.RAW_EVENT_RETAIN_FULL_PAYLOAD === "true") {
    return "debug";
  }
  return "sample";
}

function summarizePayload(payload: unknown): {
  returnedCount: number | null;
  nextCursor: string | null;
  payloadHash: string;
} {
  const json = JSON.stringify(payload ?? null);
  const hash = createHash("sha256").update(json).digest("hex");
  const data = isRecord(payload) ? payload.data : undefined;
  const children = isRecord(data) && Array.isArray(data.children) ? data.children : undefined;
  const after = isRecord(data) && typeof data.after === "string" ? data.after : null;
  return {
    returnedCount: children ? children.length : null,
    nextCursor: after,
    payloadHash: hash,
  };
}

function resolveListing(endpoint: string): string | null {
  if (endpoint.includes("/new.json")) {
    return "new";
  }
  if (endpoint.includes("/top.json")) {
    return "top";
  }
  if (endpoint.includes("/about.json")) {
    return "about";
  }
  return null;
}

function resolveProvider(
  responseHeaders: Record<string, string> | undefined,
  requestParamProvider: string | number | boolean | undefined,
): string | null {
  const headerProvider = responseHeaders?.["x-provider"];
  if (typeof headerProvider === "string" && headerProvider.trim().length > 0) {
    return headerProvider;
  }
  return stringParam(requestParamProvider);
}

function stringParam(value: string | number | boolean | undefined): string | null {
  if (value == null || value === "") {
    return null;
  }
  return String(value);
}

function numberParam(value: string | number | boolean | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
