import type { Pool } from "pg";
import type { Actor, Filter } from "../../../packages/contracts/src/source-content";
import { projectSources } from "../projects/index";
import { fail } from "../../storage/db";
import { compileContentFilter, contentSelect } from "./search";
import { contentFromRow } from "./sql";

export async function readThread(
  pool: Pool, actor: Actor, id: string, projectId: string | undefined,
  filter: Filter, view: "top" | "matches" | "op",
) {
  const project = projectId ? await projectSources(pool, actor, projectId) : undefined;
  const compiled = compileContentFilter(actor, filter, project?.source_ids, project?.filter);
  compiled.values.push(id);
  const idParam = `$${compiled.values.length}::uuid`;
  const match = compiled;
  const rows = (await pool.query(`
    WITH RECURSIVE ancestors AS (
      SELECT c.id,c.source_id,c.external_id,c.kind,c.content_references,0 AS depth,ARRAY[c.id] AS path
      FROM content c WHERE c.id=${idParam}
        AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
      UNION ALL
      SELECT parent.id,parent.source_id,parent.external_id,parent.kind,parent.content_references,a.depth+1,a.path||parent.id
      FROM ancestors a
      JOIN LATERAL (
        SELECT c.id,c.source_id,c.external_id,c.kind,c.content_references
        FROM jsonb_array_elements(a.content_references) r(value)
        JOIN content c ON c.source_id=a.source_id AND c.kind=r.value->>'kind' AND c.external_id=r.value->>'externalId'
        WHERE r.value->>'relation' IN ('thread_root','reply_to') AND NOT c.id=ANY(a.path)
          AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
        ORDER BY (r.value->>'relation'='thread_root') DESC,c.id LIMIT 1
      ) parent ON a.depth<32
    ), root AS (
      SELECT id,source_id,external_id,kind,
        content_references @> '[{"relation":"thread_root"}]'::jsonb OR
          content_references @> '[{"relation":"reply_to"}]'::jsonb AS context_missing
      FROM ancestors ORDER BY depth DESC LIMIT 1
    ), descendants AS (
      SELECT id,external_id,kind FROM root
      UNION
      SELECT c.id,c.external_id,c.kind FROM descendants parent CROSS JOIN root
      JOIN content c ON c.source_id=root.source_id
      WHERE (c.content_references @> jsonb_build_array(jsonb_build_object('relation','reply_to','kind',parent.kind,'externalId',parent.external_id))
          OR (parent.id=root.id AND c.content_references @> jsonb_build_array(
            jsonb_build_object('relation','thread_root','kind',root.kind,'externalId',root.external_id))))
        AND EXISTS (SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
    ), sample AS MATERIALIZED (
      SELECT id FROM descendants LIMIT 200
    )
    ${contentSelect(compiled.visible, `, root.context_missing, (${match.text}) AS matched`)}
    JOIN root ON root.source_id=c.source_id
    WHERE c.id IN (SELECT id FROM ancestors UNION SELECT id FROM sample)
    ORDER BY (c.id=root.id) DESC, (c.id=${idParam}) DESC, (c.id IN (SELECT id FROM ancestors)) DESC,
      c.created_at_source DESC NULLS LAST,c.id
    LIMIT 200`, compiled.values)).rows;
  if (!rows.length) fail(404, "Content not found");
  const root = contentFromRow(rows[0]);
  const items = rows.map(contentFromRow);
  const byExternal = new Map(items.map((item) => [`${item.kind}:${item.externalId}`, item]));
  const score = (item: (typeof items)[number]) => Math.max(0, ...item.observations.map(({ metrics }) =>
    metrics["reddit.score"] ?? metrics["x.likes"] ?? 0));
  const nodes = items.slice(1).map((item, index) => {
    const parent = item.references.find(({ relation }) => relation === "reply_to");
    const seen = new Set([item.id]);
    let depth = 0, cursor = item, contextMissing = false;
    while (cursor.id !== root.id && depth < 32) {
      const ref = cursor.references.find(({ relation }) => relation === "reply_to");
      const next = ref && byExternal.get(`${ref.kind}:${ref.externalId}`);
      if (!next || seen.has(next.id)) {
        contextMissing = true;
        break;
      }
      seen.add(next.id);
      cursor = next;
      depth++;
    }
    const rootAuthor = root.author;
    const isOp = item.platformDetails.extensions?.isOp === true || Boolean(
      rootAuthor?.externalId && rootAuthor.externalId === item.author?.externalId ||
      rootAuthor?.handle && rootAuthor.handle.toLowerCase() === item.author?.handle?.toLowerCase(),
    );
    return {
      item, depth, isOp, parentId: parent ? byExternal.get(`${parent.kind}:${parent.externalId}`)?.id ?? null : null,
      contextMissing: contextMissing || cursor.id !== root.id,
      matched: Boolean(rows[index + 1].matched),
    };
  });
  const selected = nodes.filter(node => view === "top" || (view === "matches" ? node.matched : node.isOp));
  const groups = new Map<string | null, typeof nodes>();
  const active = new Set(selected.map(({ item }) => item.id));
  for (const node of selected.sort((a, b) => score(b.item) - score(a.item))) {
    const parent = !node.contextMissing && node.parentId && active.has(node.parentId) ? node.parentId : null;
    const siblings = groups.get(parent) ?? [];
    siblings.push(node);
    groups.set(parent, siblings);
  }
  const ordered: typeof nodes = [];
  function append(parent: string | null) {
    for (const node of groups.get(parent) ?? []) {
      ordered.push(node);
      append(node.item.id);
    }
  }
  append(null);
  return { root, nodes: ordered, contextMissing: Boolean(rows[0].context_missing), capped: rows.length === 200 };
}
