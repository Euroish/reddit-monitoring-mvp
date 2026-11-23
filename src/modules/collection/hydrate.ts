import { createHash, randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Hydrate } from "../../../packages/contracts/src/collection";
import type { Filter } from "../../../packages/contracts/src/content";
import { fail } from "../../shared/errors";
import { findHydratableRedditPosts, type BatchMembership } from "../content/index";
import { admitViewerCollection } from "./policy";

export async function enqueueHydrationForScope(
  client: PoolClient,
  actor: Actor,
  scope: { projectId: string; sourceIds: string[]; filter: Filter; batchMembership?: BatchMembership },
  key: string,
  input: Static<typeof Hydrate>,
) {
  const ids = [...input.contentIds].sort();
  const hash = createHash("sha256").update(JSON.stringify([ids, input.maxCommentsPerPost])).digest("hex");
  const requestKey = `hydrate:${scope.projectId}:${key}`;
  const existing = (
    await client.query<{ id: string; payload_hash: string; collection_source_id: string }>(
      "SELECT id,payload_hash,collection_source_id FROM source_collection_job WHERE operation='hydrate' AND request_key=$1 ORDER BY id",
      [requestKey],
    )
  ).rows;
  if (existing.length) {
    if (!existing.every((job) => scope.sourceIds.includes(job.collection_source_id))) {
      fail(404, "Collection job not found");
    }
    if (existing[0].payload_hash !== hash) {
      fail(409, "Idempotency key already used with different posts");
    }
    return { jobIds: existing.map((job) => job.id), created: false };
  }
  const roots = await findHydratableRedditPosts(
    client,
    actor,
    { sourceIds: scope.sourceIds, filter: scope.filter, batchMembership: scope.batchMembership },
    ids,
  );
  if (roots.length !== ids.length) {
    fail(422, "Select Reddit root posts with an active kaix source in this project");
  }
  const jobIds: string[] = [];
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
    const request = { postId: root.external_id, includeComments: true, maxCommentsPerPost: input.maxCommentsPerPost,
      ...(scope.batchMembership ? { projectId: scope.projectId } : {}) };
    await client.query(
      `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
        page_size,max_pages,next_run_at,created_at,request_key,payload_hash,request_json,
        requested_by_user_id,requested_by_client_kind)
      VALUES($1,$2,'queued','manual','hydrate','kaix',NOW()-interval '1 second',NOW(),$3,1,NOW(),NOW(),$4,$5,$6,$7,$8)`,
      [id, root.source_id, input.maxCommentsPerPost, requestKey, hash, request, actor.userId, actor.clientKind],
    );
    jobIds.push(id);
  }
  return { jobIds, created: true };
}
