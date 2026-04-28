import type {
  PostEngagementLatest,
  PostEngagementWindow,
} from "../../../domain/entities/post-engagement";
import type { PostEngagementRepository } from "../../../domain/repositories/post-engagement-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { SOURCE_IDS } from "../../postgres/postgres.constants";
import {
  mapPostEngagementLatest,
  mapPostEngagementWindow,
  type PostEngagementLatestRow,
  type PostEngagementWindowRow,
} from "./postgres-row-mappers";
import { buildValuesPlaceholders, chunkArray } from "./postgres-sql.utils";

export class PostgresPostEngagementRepository implements PostEngagementRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsertLatestMany(rows: PostEngagementLatest[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const deduped = dedupeLatest(rows);
    const sourceId = SOURCE_IDS.reddit;
    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(deduped, 1000)) {
        const values: unknown[] = [];
        for (const row of group) {
          values.push(
            row.contentId,
            row.targetId,
            sourceId,
            row.observedAt,
            row.score ?? null,
            row.numComments ?? null,
            row.upvoteRatio ?? null,
            row.collectionJobId,
          );
        }

        await client.query(
          `
          INSERT INTO post_engagement_latest (
            content_id, target_id, source_id, observed_at, score, num_comments, upvote_ratio, collection_job_id
          ) VALUES ${buildValuesPlaceholders(group.length, 8)}
          ON CONFLICT (content_id) DO UPDATE
          SET
            target_id = EXCLUDED.target_id,
            source_id = EXCLUDED.source_id,
            observed_at = EXCLUDED.observed_at,
            score = COALESCE(EXCLUDED.score, post_engagement_latest.score),
            num_comments = COALESCE(EXCLUDED.num_comments, post_engagement_latest.num_comments),
            upvote_ratio = COALESCE(EXCLUDED.upvote_ratio, post_engagement_latest.upvote_ratio),
            collection_job_id = EXCLUDED.collection_job_id,
            updated_at = NOW()
          WHERE EXCLUDED.observed_at >= post_engagement_latest.observed_at
          `,
          values,
        );
      }
    });
  }

  public async upsertWindowedMany(rows: PostEngagementWindow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const deduped = dedupeWindows(rows);
    const sourceId = SOURCE_IDS.reddit;
    await this.db.withTransaction(async (client) => {
      for (const group of chunkArray(deduped, 1000)) {
        const values: unknown[] = [];
        for (const row of group) {
          values.push(
            row.targetId,
            row.contentId,
            sourceId,
            row.windowStart,
            row.windowEnd,
            row.observedAt,
            row.score ?? null,
            row.numComments ?? null,
            row.upvoteRatio ?? null,
            row.collectionJobId,
          );
        }

        await client.query(
          `
          INSERT INTO post_engagement_window (
            target_id, content_id, source_id, window_start, window_end, observed_at,
            score, num_comments, upvote_ratio, collection_job_id
          ) VALUES ${buildValuesPlaceholders(group.length, 10)}
          ON CONFLICT (target_id, content_id, window_start) DO UPDATE
          SET
            source_id = EXCLUDED.source_id,
            window_end = EXCLUDED.window_end,
            observed_at = EXCLUDED.observed_at,
            score = COALESCE(EXCLUDED.score, post_engagement_window.score),
            num_comments = COALESCE(EXCLUDED.num_comments, post_engagement_window.num_comments),
            upvote_ratio = COALESCE(EXCLUDED.upvote_ratio, post_engagement_window.upvote_ratio),
            collection_job_id = EXCLUDED.collection_job_id,
            updated_at = NOW()
          WHERE EXCLUDED.observed_at >= post_engagement_window.observed_at
          `,
          values,
        );
      }
    });
  }

  public async listLatestByContentIdsInRange(args: {
    contentIds: string[];
    from: string;
    to: string;
  }): Promise<PostEngagementLatest[]> {
    if (args.contentIds.length === 0) {
      return [];
    }

    const result = await this.db.query<PostEngagementLatestRow>(
      `
      SELECT content_id, target_id, observed_at, score, num_comments, upvote_ratio,
             collection_job_id, created_at, updated_at
      FROM post_engagement_latest
      WHERE content_id = ANY($1::uuid[])
        AND observed_at >= $2
        AND observed_at <= $3
      ORDER BY observed_at ASC, content_id ASC
      `,
      [args.contentIds, args.from, args.to],
    );

    return result.rows.map(mapPostEngagementLatest);
  }

  public async listWindowedByTargetInRange(args: {
    targetId: string;
    from: string;
    to: string;
  }): Promise<PostEngagementWindow[]> {
    const result = await this.db.query<PostEngagementWindowRow>(
      `
      SELECT target_id, content_id, window_start, window_end, observed_at, score, num_comments,
             upvote_ratio, collection_job_id, created_at, updated_at
      FROM post_engagement_window
      WHERE target_id = $1
        AND window_start >= $2
        AND window_start <= $3
      ORDER BY window_start ASC, content_id ASC
      `,
      [args.targetId, args.from, args.to],
    );

    return result.rows.map(mapPostEngagementWindow);
  }
}

function dedupeLatest(rows: PostEngagementLatest[]): PostEngagementLatest[] {
  const byContentId = new Map<string, PostEngagementLatest>();
  for (const row of rows) {
    const current = byContentId.get(row.contentId);
    if (!current || row.observedAt >= current.observedAt) {
      byContentId.set(row.contentId, mergeLatest(current, row));
    }
  }
  return Array.from(byContentId.values());
}

function dedupeWindows(rows: PostEngagementWindow[]): PostEngagementWindow[] {
  const byKey = new Map<string, PostEngagementWindow>();
  for (const row of rows) {
    const key = `${row.targetId}|${row.contentId}|${row.windowStart}`;
    const current = byKey.get(key);
    if (!current || row.observedAt >= current.observedAt) {
      byKey.set(key, mergeWindow(current, row));
    }
  }
  return Array.from(byKey.values());
}

function mergeLatest(
  current: PostEngagementLatest | undefined,
  next: PostEngagementLatest,
): PostEngagementLatest {
  if (!current) {
    return next;
  }
  return {
    ...next,
    score: next.score ?? current.score,
    numComments: next.numComments ?? current.numComments,
    upvoteRatio: next.upvoteRatio ?? current.upvoteRatio,
  };
}

function mergeWindow(
  current: PostEngagementWindow | undefined,
  next: PostEngagementWindow,
): PostEngagementWindow {
  if (!current) {
    return next;
  }
  return {
    ...next,
    score: next.score ?? current.score,
    numComments: next.numComments ?? current.numComments,
    upvoteRatio: next.upvoteRatio ?? current.upvoteRatio,
  };
}
