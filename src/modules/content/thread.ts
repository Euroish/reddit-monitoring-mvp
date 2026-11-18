import type { Pool } from "pg";
import type { Actor, Filter } from "../../../packages/contracts/src/source-content";
import { projectSources } from "../projects/sql";
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
    WITH seed AS (
      SELECT c.* FROM content c WHERE c.id=${idParam}
      AND EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
    ), root AS (
      SELECT COALESCE(root.id,seed.id) AS id,seed.source_id,
        COALESCE(root.external_id,seed.external_id) AS external_id, COALESCE(root.kind,seed.kind) AS kind,
        root.id IS NULL AND ref.value IS NOT NULL AS context_missing
      FROM seed
      LEFT JOIN LATERAL (
        SELECT value FROM jsonb_array_elements(seed.content_references) r(value) WHERE value->>'relation'='thread_root' LIMIT 1
      ) ref ON true
      LEFT JOIN LATERAL (
        SELECT c.id,c.external_id,c.kind FROM content c WHERE c.source_id=seed.source_id
          AND c.external_id=ref.value->>'externalId' AND c.kind=ref.value->>'kind'
          AND EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
      ) root ON true
    )
    ${contentSelect(compiled.visible, `, root.id AS root_id,root.context_missing, (${match.text}) AS matched`)}
    JOIN root ON root.source_id=c.source_id
    WHERE (c.id=root.id OR c.id=${idParam} OR
      c.content_references @> jsonb_build_array(jsonb_build_object('relation','thread_root','kind',root.kind,'externalId',root.external_id)) OR
      c.content_references @> jsonb_build_array(jsonb_build_object('relation','reply_to','kind',root.kind,'externalId',root.external_id)))
    AND EXISTS(SELECT 1 FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id WHERE ${compiled.visible})
    ORDER BY (c.id=root.id) DESC, (c.id=${idParam}) DESC, c.created_at_source DESC NULLS LAST,c.id
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
    return {
      item, depth, parentId: parent ? byExternal.get(`${parent.kind}:${parent.externalId}`)?.id ?? null : null,
      contextMissing: contextMissing || cursor.id !== root.id,
      matched: Boolean(rows[index + 1].matched),
    };
  });
  const rootAuthor = root.author?.handle?.toLowerCase();
  const selected = nodes.filter(({ item, matched }) =>
    view === "top" || (view === "matches" ? matched : !!rootAuthor && item.author?.handle?.toLowerCase() === rootAuthor));
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
