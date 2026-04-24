import type { SavedWorkbenchView } from "../../../domain/entities/saved-workbench-view";
import type { SavedWorkbenchViewRepository } from "../../../domain/repositories/saved-workbench-view-repository";
import type { PostgresClient } from "../../postgres/postgres-client";

interface SavedWorkbenchViewRow {
  id: string;
  user_id: string;
  name: string;
  view_kind: "target" | "comparison";
  primary_target: string;
  compare_targets: string[];
  keywords: string[];
  series_ids: string[];
  route_path: string;
  created_at: string;
  updated_at: string;
}

export class PostgresSavedWorkbenchViewRepository implements SavedWorkbenchViewRepository {
  constructor(private readonly db: PostgresClient) {}

  public async upsert(view: SavedWorkbenchView): Promise<SavedWorkbenchView> {
    const result = await this.db.query<SavedWorkbenchViewRow>(
      `
      INSERT INTO saved_workbench_view (
        id, user_id, name, view_kind, primary_target, compare_targets, keywords,
        series_ids, route_path, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::text[], $7::text[], $8::text[], $9, $10, $11
      )
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        view_kind = EXCLUDED.view_kind,
        primary_target = EXCLUDED.primary_target,
        compare_targets = EXCLUDED.compare_targets,
        keywords = EXCLUDED.keywords,
        series_ids = EXCLUDED.series_ids,
        route_path = EXCLUDED.route_path,
        updated_at = EXCLUDED.updated_at
      RETURNING
        id, user_id, name, view_kind, primary_target, compare_targets, keywords,
        series_ids, route_path, created_at, updated_at
      `,
      [
        view.id,
        view.userId,
        view.name,
        view.viewKind,
        view.primaryTarget,
        view.compareTargets,
        view.keywords,
        view.seriesIds,
        view.routePath,
        view.createdAt,
        view.updatedAt,
      ],
    );

    return mapSavedWorkbenchView(result.rows[0]);
  }

  public async listByUser(args: {
    userId: string;
    limit: number;
  }): Promise<SavedWorkbenchView[]> {
    const result = await this.db.query<SavedWorkbenchViewRow>(
      `
      SELECT
        id, user_id, name, view_kind, primary_target, compare_targets, keywords,
        series_ids, route_path, created_at, updated_at
      FROM saved_workbench_view
      WHERE user_id = $1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT $2
      `,
      [args.userId, args.limit],
    );
    return result.rows.map(mapSavedWorkbenchView);
  }
}

function mapSavedWorkbenchView(row: SavedWorkbenchViewRow): SavedWorkbenchView {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    viewKind: row.view_kind,
    primaryTarget: row.primary_target,
    compareTargets: row.compare_targets,
    keywords: row.keywords,
    seriesIds: row.series_ids as SavedWorkbenchView["seriesIds"],
    routePath: row.route_path,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
