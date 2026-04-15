import type { RawEnvelope } from "../../../connectors/shared/connector.interface";
import type { RawEventRepository } from "../../../domain/repositories/raw-event-repository";
import type { SqlQueryable } from "../../postgres/postgres-client";

export class PostgresRawEventRepository implements RawEventRepository {
  constructor(private readonly db: SqlQueryable) {}

  public async append<TPayload>(event: {
    collectionJobId: string;
    targetId: string;
    envelope: RawEnvelope<TPayload>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO raw_reddit_event (
        collection_job_id, target_id, endpoint, request_params, http_status, response_headers, payload, fetched_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8)
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
  }
}

