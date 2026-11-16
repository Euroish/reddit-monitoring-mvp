import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  Actor,
  Filter,
} from "../../../packages/contracts/src/source-content";
import { compileContentFilter } from "../content/search";
import { fail } from "../../storage/db";

export async function listSavedQueries(pool: Pool, actor: Actor) {
  return (
    await pool.query(
      "SELECT id,name,query,revision,created_at,updated_at FROM content_saved_query WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 100",
      [actor.userId],
    )
  ).rows;
}
export async function saveQuery(
  pool: Pool,
  actor: Actor,
  name: string,
  filter: Filter,
) {
  return (
    await pool.query(
      "INSERT INTO content_saved_query(id,user_id,name,query,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW()) RETURNING id",
      [randomUUID(), actor.userId, name, filter],
    )
  ).rows[0];
}
export async function listAnnotations(pool: Pool, actor: Actor) {
  const compiled = compileContentFilter(actor, {});
  compiled.values.push(actor.userId);
  return (
    await pool.query(
      `SELECT a.content_id,a.favorite,a.note,a.revision,c.title,c.body_text,c.external_id FROM content_annotation a JOIN content c ON c.id=a.content_id JOIN source p ON p.id=c.source_id JOIN public_content_search_document doc ON doc.content_id=c.id
    WHERE ${compiled.text} AND a.user_id=$${compiled.values.length} ORDER BY a.updated_at DESC,a.content_id DESC LIMIT 100`,
      compiled.values,
    )
  ).rows;
}
export async function updateAnnotation(
  pool: Pool,
  actor: Actor,
  contentId: string,
  favorite: boolean,
  note: string,
  revision: number,
) {
  const compiled = compileContentFilter(actor, {});
  compiled.values.push(contentId);
  const visible = await pool.query(
    `SELECT c.id FROM content c JOIN source p ON p.id=c.source_id WHERE ${compiled.text} AND c.id=$${compiled.values.length}`,
    compiled.values,
  );
  if (!visible.rowCount) fail(404, "Content not found");
  const result = await pool.query(
    `INSERT INTO content_annotation(user_id,content_id,favorite,note,created_at,updated_at)
    SELECT $1,$2,$3,$4,NOW(),NOW() WHERE $5=0 OR EXISTS(SELECT 1 FROM content_annotation WHERE user_id=$1 AND content_id=$2)
    ON CONFLICT(user_id,content_id) DO UPDATE SET favorite=EXCLUDED.favorite,note=EXCLUDED.note,updated_at=NOW(),revision=content_annotation.revision+1 WHERE content_annotation.revision=$5 RETURNING revision`,
    [actor.userId, contentId, favorite, note, revision],
  );
  if (!result.rowCount) fail(409, "Annotation changed; reload before saving");
  return result.rows[0];
}
