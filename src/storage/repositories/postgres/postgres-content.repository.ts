import type { Content } from "../../../domain/entities/content";
import type { ContentRepository } from "../../../domain/repositories/content-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import { mapContent, type ContentRow } from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray, maxIso, minIso } from "./postgres-sql.utils";

export class PostgresContentRepository implements ContentRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertMany(contents: Content[]): Promise<void> {
    if (contents.length === 0) {
      return;
    }

    const deduped = this.dedupeContents(contents);
    const sourceId = SOURCE_IDS.reddit;
    const chunkSize = 250;

    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(deduped, chunkSize)) {
        const values: unknown[] = [];
        for (const content of group) {
          values.push(
            content.id,
            sourceId,
            content.targetId,
            content.accountId ?? null,
            content.externalId,
            content.kind,
            content.title,
            content.bodyText ?? null,
            content.url ?? null,
            content.permalink,
            content.createdAtSource,
            content.firstSeenAt,
            content.lastSeenAt,
          );
        }

        const placeholders = buildValuesPlaceholders(group.length, 13);
        await client.query(
          `
          INSERT INTO content (
            id, source_id, target_id, account_id, external_id, kind, title, body_text, url, permalink,
            created_at_source, first_seen_at, last_seen_at
          ) VALUES ${placeholders}
          ON CONFLICT (source_id, external_id)
          DO UPDATE SET
            target_id = EXCLUDED.target_id,
            account_id = EXCLUDED.account_id,
            title = EXCLUDED.title,
            body_text = EXCLUDED.body_text,
            url = EXCLUDED.url,
            permalink = EXCLUDED.permalink,
            created_at_source = EXCLUDED.created_at_source,
            first_seen_at = LEAST(content.first_seen_at, EXCLUDED.first_seen_at),
            last_seen_at = GREATEST(content.last_seen_at, EXCLUDED.last_seen_at)
          `,
          values,
        );
      }
    });
  }

  public async countExistingExternalIds(args: {
    targetId: string;
    externalIds: string[];
  }): Promise<number> {
    const existingExternalIds = await this.findExistingExternalIds(args);
    return existingExternalIds.length;
  }

  public async findExistingExternalIds(args: {
    targetId: string;
    externalIds: string[];
  }): Promise<string[]> {
    const externalIds = Array.from(new Set(args.externalIds.map((item) => item.trim()).filter(Boolean)));
    if (externalIds.length === 0) {
      return [];
    }

    const result = await this.db.query<{ external_id: string }>(
      `
      SELECT external_id
      FROM content
      WHERE target_id = $1
        AND external_id = ANY($2::text[])
      `,
      [args.targetId, externalIds],
    );

    return result.rows.map((row) => row.external_id);
  }

  public async findRecentByTarget(targetId: string, limit: number): Promise<Content[]> {
    const result = await this.db.query<ContentRow>(
      `
      SELECT id, target_id, account_id, external_id, kind, title, body_text, url, permalink,
             created_at_source, first_seen_at, last_seen_at
      FROM content
      WHERE target_id = $1
      ORDER BY created_at_source DESC
      LIMIT $2
      `,
      [targetId, limit],
    );

    return result.rows.map(mapContent);
  }

  public async findByTargetCreatedAtRange(args: {
    targetId: string;
    from: string;
    to: string;
    limit?: number;
  }): Promise<Content[]> {
    const result = await this.db.query<ContentRow>(
      `
      SELECT id, target_id, account_id, external_id, kind, title, body_text, url, permalink,
             created_at_source, first_seen_at, last_seen_at
      FROM content
      WHERE target_id = $1
        AND created_at_source >= $2
        AND created_at_source <= $3
      ORDER BY created_at_source ASC
      LIMIT $4
      `,
      [args.targetId, args.from, args.to, args.limit ?? 5000],
    );

    return result.rows.map(mapContent);
  }

  private dedupeContents(contents: Content[]): Content[] {
    const byExternalId = new Map<string, Content>();

    for (const content of contents) {
      const current = byExternalId.get(content.externalId);
      if (!current) {
        byExternalId.set(content.externalId, { ...content });
        continue;
      }

      const useIncoming = content.lastSeenAt >= current.lastSeenAt;
      const next: Content = {
        ...(useIncoming ? content : current),
        firstSeenAt: minIso(current.firstSeenAt, content.firstSeenAt),
        lastSeenAt: maxIso(current.lastSeenAt, content.lastSeenAt),
      };

      byExternalId.set(content.externalId, next);
    }

    return Array.from(byExternalId.values());
  }
}
