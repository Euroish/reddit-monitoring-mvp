import { createHash, randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { Pool } from "pg";
import type { Actor, Hydrate } from "../../../packages/contracts/src/source-content";
import { fail, transaction } from "../../storage/db";
import { compileContentFilter, matchedAnchors } from "../content/index";
import { projectSources } from "../projects/index";
import { admitViewerCollection } from "./policy";

export async function enqueueHydration(pool: Pool, actor: Actor, projectId: string, key: string, input: Static<typeof Hydrate>) {
  const ids = [...input.contentIds].sort();
  const hash = createHash("sha256").update(JSON.stringify([ids, input.maxCommentsPerPost])).digest("hex");
  const requestKey = `hydrate:${projectId}:${key}`;
  return transaction(pool, async (client) => {
    await client.query("SELECT id FROM monitor_project WHERE id=$1 FOR UPDATE", [projectId]);
    const project = await projectSources(client, actor, projectId);
    const existing = (await client.query(
      "SELECT id,payload_hash,collection_source_id FROM source_collection_job WHERE operation='hydrate' AND request_key=$1 ORDER BY id",
      [requestKey],
    )).rows;
    if (existing.length) {
      if (!existing.every((job) => project.source_ids.includes(job.collection_source_id))) fail(404, "Collection job not found");
      if (existing[0].payload_hash !== hash) fail(409, "Idempotency key already used with different posts");
      return { jobIds: existing.map((job) => job.id) };
    }
    const batchProjectId = project.dataset_mode === "batch" ? project.id : undefined;
    const compiled = compileContentFilter(actor, {}, batchProjectId ? undefined : project.source_ids, project.filter, false, batchProjectId);
    const match = matchedAnchors(compiled, true);
    compiled.values.push(ids, project.source_ids);
    const roots = (await client.query(`
      ${match.cte}
      SELECT c.external_id, target.id AS source_id
      FROM content c JOIN source p ON p.id=c.source_id ${match.joins}
      JOIN LATERAL (
        SELECT cs.id FROM content_discovery d JOIN collection_source cs ON cs.id=d.collection_source_id
        WHERE d.content_id=c.id AND cs.id=ANY($${compiled.values.length}::uuid[]) AND cs.primary_provider='kaix'
          AND cs.delivery_mode='pull' AND cs.state='active' AND NOT cs.automatic_collection_blocked
        ORDER BY cs.id LIMIT 1
      ) target ON true
      WHERE p.code='reddit' AND c.kind='post' AND c.external_id ~ '^t3_[a-z0-9]{2,32}$'
        AND c.id=ANY($${compiled.values.length - 1}::uuid[])
      ORDER BY target.id,c.id`, compiled.values)).rows;
    if (roots.length !== ids.length) fail(422, "Select Reddit root posts with an active kaix source in this project");
    const jobIds = [];
    for (const root of roots) {
      await admitViewerCollection(client, actor, {
        provider: "kaix",
        sourceId: root.source_id,
        limit: input.maxCommentsPerPost,
        resources: input.maxCommentsPerPost + 1,
        includeComments: true,
        maxCommentsPerPost: input.maxCommentsPerPost,
      });
      const id = randomUUID();
      const request = { postId: root.external_id, includeComments: true, maxCommentsPerPost: input.maxCommentsPerPost };
      await client.query(`
        INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
          page_size,max_pages,next_run_at,created_at,request_key,payload_hash,request_json,
          requested_by_user_id,requested_by_client_kind)
        VALUES($1,$2,'queued','manual','hydrate','kaix',NOW()-interval '1 second',NOW(),$3,1,NOW(),NOW(),$4,$5,$6,$7,$8)`,
        [
          id, root.source_id, input.maxCommentsPerPost, requestKey, hash, request,
          actor.userId, actor.clientKind,
        ]);
      jobIds.push(id);
    }
    return { jobIds };
  });
}
