import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Filter } from "../../../packages/contracts/src/content";
import { fail } from "../../shared/errors";
import { isContentVisibleToActor, loadAnnotatedContentByIds } from "../content/index";

export async function listSavedQueries(pool: Pool, actor: Actor) {
  return (
    await pool.query(
      "SELECT id,name,query,revision,created_at,updated_at FROM content_saved_query WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 100",
      [actor.userId],
    )
  ).rows;
}

export async function saveQuery(pool: Pool, actor: Actor, name: string, filter: Filter) {
  return (
    await pool.query(
      "INSERT INTO content_saved_query(id,user_id,name,query,created_at,updated_at) VALUES($1,$2,$3,$4,NOW(),NOW()) RETURNING id",
      [randomUUID(), actor.userId, name, filter],
    )
  ).rows[0];
}

export async function listAnnotations(pool: Pool, actor: Actor) {
  const annotations = (
    await pool.query<{ content_id: string; favorite: boolean; note: string; revision: number }>(
      "SELECT content_id,favorite,note,revision FROM content_annotation WHERE user_id=$1 ORDER BY updated_at DESC,content_id DESC LIMIT 100",
      [actor.userId],
    )
  ).rows;
  const contentById = await loadAnnotatedContentByIds(
    pool,
    actor,
    annotations.map((row) => row.content_id),
  );
  return annotations.flatMap((row) => {
    const content = contentById.get(row.content_id);
    if (!content) return [];
    return [
      {
        content_id: row.content_id,
        favorite: row.favorite,
        note: row.note,
        revision: row.revision,
        title: content.title,
        body_text: content.body_text,
        external_id: content.external_id,
      },
    ];
  });
}

export async function updateAnnotation(
  pool: Pool,
  actor: Actor,
  contentId: string,
  favorite: boolean,
  note: string,
  revision: number,
) {
  if (!(await isContentVisibleToActor(pool, actor, contentId))) {
    fail(404, "Content not found");
  }
  const result = await pool.query(
    `INSERT INTO content_annotation(user_id,content_id,favorite,note,created_at,updated_at)
     SELECT $1,$2,$3,$4,NOW(),NOW() WHERE $5=0 OR EXISTS(SELECT 1 FROM content_annotation WHERE user_id=$1 AND content_id=$2)
     ON CONFLICT(user_id,content_id) DO UPDATE SET favorite=EXCLUDED.favorite,note=EXCLUDED.note,updated_at=NOW(),revision=content_annotation.revision+1 WHERE content_annotation.revision=$5 RETURNING revision`,
    [actor.userId, contentId, favorite, note, revision],
  );
  if (!result.rowCount) fail(409, "Annotation changed; reload before saving");
  return result.rows[0];
}
