import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Static } from "@sinclair/typebox";
import type { Actor, Filter, ProjectInput } from "../../../packages/contracts/src/source-content";
import { transaction, fail } from "../../storage/db";
import { compileContentFilter, matchingNodes } from "../content/search";

type ProjectWrite = Static<typeof ProjectInput>;
export interface Project {
  id: string;
  name: string;
  filter: Filter;
  revision: number;
  thread_aware: boolean;
  include_push_in_trends: boolean;
  source_ids: string[];
}

export async function listProjects(pool: Pool | PoolClient, actor: Actor, id?: string) {
  return (await pool.query<Project>(`
    SELECT p.*, s.source_ids FROM monitor_project p
    CROSS JOIN LATERAL (
      SELECT ARRAY(SELECT collection_source_id FROM monitor_project_source WHERE project_id=p.id ORDER BY collection_source_id) AS source_ids
    ) s
    WHERE ($1::uuid[] IS NULL OR s.source_ids <@ $1) AND ($2::uuid IS NULL OR p.id=$2)
    ORDER BY p.updated_at DESC`, [actor.allowedSourceIds, id ?? null])).rows;
}

export async function projectSources(pool: Pool | PoolClient, actor: Actor, id: string) {
  const [project] = await listProjects(pool, actor, id);
  if (!project) fail(404, "Project not found");
  return project;
}

export async function writeProject(pool: Pool, actor: Actor, input: ProjectWrite, update?: { id: string; revision: number }) {
  const sources = [...new Set(input.sourceIds)];
  if (actor.allowedSourceIds !== null && !sources.every((id) => actor.allowedSourceIds!.includes(id)))
    fail(404, "Source not found");
  return transaction(pool, async (client) => {
    const id = update?.id ?? randomUUID();
    const fields = [id, input.name, input.filter, input.threadAware, input.includePushInTrends];
    if (update) {
      await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [id]);
      await projectSources(client, actor, id);
      const result = await client.query(`
        UPDATE monitor_project SET name=$2,filter=$3,thread_aware=COALESCE($4,thread_aware),
          include_push_in_trends=COALESCE($5,include_push_in_trends),revision=revision+1,updated_at=NOW()
        WHERE id=$1 AND revision=$6`, [...fields, update.revision]);
      if (!result.rowCount) fail(409, "Project changed; reload before saving");
      await client.query("DELETE FROM monitor_project_source WHERE project_id=$1", [id]);
    } else {
      await client.query(`
        INSERT INTO monitor_project(id,name,filter,thread_aware,include_push_in_trends,owner_user_id)
        VALUES($1,$2,$3,COALESCE($4,TRUE),COALESCE($5,FALSE),$6)`, [...fields, actor.userId]);
    }
    await client.query(
      "INSERT INTO monitor_project_source(project_id,collection_source_id) SELECT $1,UNNEST($2::uuid[])",
      [id, sources],
    );
    return projectSources(client, actor, id);
  });
}

export async function deleteProject(pool: Pool, actor: Actor, id: string, revision: number) {
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [id]);
    await projectSources(client, actor, id);
    const result = await client.query("DELETE FROM monitor_project WHERE id=$1 AND revision=$2", [id, revision]);
    if (!result.rowCount) fail(409, "Project changed; reload before deleting");
    return { deleted: true };
  });
}

export async function projectOverview(pool: Pool, actor: Actor, id: string) {
  const project = await projectSources(pool, actor, id);
  const compiled = compileContentFilter(actor, {}, project.source_ids, project.filter, !project.include_push_in_trends);
  const anchorCount = project.thread_aware ? "COUNT(DISTINCT c.anchor_id)" : "COUNT(*)";
  const [row] = (await pool.query<{
    facets: {
      day_group: number; platform_group: number; kind_group: number;
      day: string | null; platform: string | null; kind: string | null;
      count: number; matchedContentCount: number;
    }[];
    providers: string[];
  }>(`
    WITH matched AS (${matchingNodes(compiled, project.thread_aware)}), facets AS (
      SELECT GROUPING(date_trunc('day',c.created_at_source,'UTC')) AS day_group,
        GROUPING(c.platform) AS platform_group,GROUPING(c.kind) AS kind_group,
        date_trunc('day',c.created_at_source,'UTC') AS day,c.platform,c.kind,
        ${anchorCount} AS count,COUNT(*) AS "matchedContentCount"
      FROM matched c
      GROUP BY GROUPING SETS ((),(date_trunc('day',c.created_at_source,'UTC')),(c.platform),(c.kind))
    )
    SELECT (SELECT jsonb_agg(facets ORDER BY day_group DESC,day,platform,kind) FROM facets) AS facets,
      ARRAY(SELECT DISTINCT o.provider FROM matched c JOIN content_observation o ON o.content_id=c.id
        WHERE EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
          WHERE ${compiled.discovery} AND d.collection_source_id=o.collection_source_id)
        ORDER BY o.provider) AS providers`, compiled.values)).rows;
  const totals = row.facets[0];
  return {
    project,
    contentCount: totals.count,
    matchedContentCount: totals.matchedContentCount,
    facets: row.facets,
    providers: row.providers,
    resolvedFilter: project.filter,
    coverage: "stored_sample",
    threadAware: project.thread_aware,
  };
}
