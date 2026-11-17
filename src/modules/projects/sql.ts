import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  Actor,
  Filter,
} from "../../../packages/contracts/src/source-content";
import { transaction, fail } from "../../storage/db";
import { compileContentFilter } from "../content/search";

export async function projectSources(pool: Pool, actor: Actor, id: string) {
  const project = (
    await pool.query("SELECT * FROM monitor_project WHERE id=$1", [id])
  ).rows[0];
  if (!project) fail(404, "Project not found");
  const ids: string[] = (
    await pool.query(
      "SELECT collection_source_id FROM monitor_project_source WHERE project_id=$1",
      [id],
    )
  ).rows.map((row) => row.collection_source_id);
  if (
    actor.allowedSourceIds !== null &&
    !ids.every((source) => actor.allowedSourceIds!.includes(source))
  )
    fail(404, "Project not found");
  return { project, ids };
}
export async function createProject(
  pool: Pool,
  actor: Actor,
  input: { name: string; sourceIds: string[]; filter: Filter },
) {
  if (
    actor.allowedSourceIds !== null &&
    !input.sourceIds.every((id) => actor.allowedSourceIds!.includes(id))
  )
    fail(404, "Source not found");
  return transaction(pool, async (client) => {
    const id = randomUUID();
    await client.query(
      "INSERT INTO monitor_project(id,name,filter,owner_user_id) VALUES($1,$2,$3,$4)",
      [id, input.name, input.filter, actor.userId],
    );
    await client.query(
      "INSERT INTO monitor_project_source(project_id,collection_source_id) SELECT $1,UNNEST($2::uuid[])",
      [id, [...new Set(input.sourceIds)]],
    );
    return { id };
  });
}
export async function projectOverview(pool: Pool, actor: Actor, id: string) {
  const { project, ids } = await projectSources(pool, actor, id);
  const filter = project.filter as Filter,
    compiled = compileContentFilter(actor, filter, ids);
  const rows = (
    await pool.query(
      `WITH matched AS (SELECT c.id,c.created_at_source,p.code AS platform,c.kind FROM content c JOIN source p ON p.id=c.source_id JOIN public_content_search_document doc ON doc.content_id=c.id WHERE ${compiled.text})
    SELECT GROUPING(date_trunc('day',created_at_source)) AS day_group,GROUPING(platform) AS platform_group,GROUPING(kind) AS kind_group,
      date_trunc('day',created_at_source) AS day,platform,kind,COUNT(DISTINCT id)::bigint AS count
    FROM matched GROUP BY GROUPING SETS ((),(date_trunc('day',created_at_source)),(platform),(kind))`,
      compiled.values,
    )
  ).rows;
  return {
    project,
    facets: rows.map((row) => ({ ...row, count: Number(row.count) })),
    resolvedFilter: filter,
    coverage: "stored_sample",
    threadAware: false,
  };
}
