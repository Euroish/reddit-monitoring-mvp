import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ContentProviderError, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import type {
  JsonValue,
  Actor,
} from "../../../packages/contracts/src/source-content";
import { commitContentBatch, prepareContentBatch } from "../content/sql";
import { fail, transaction } from "../../storage/db";
import { lockSource, sourceFromRow } from "./sql";

const workerActor = { allowedSourceIds: null } as Actor;
export async function workOnce(
  pool: Pool,
  providers: ContentProvider[],
  signal?: AbortSignal,
) {
  if (signal?.aborted) return false;
  const claim = await transaction(pool, async (client) => {
    const candidate = (
      await client.query(`SELECT cs.id,head.id AS job_id FROM collection_source cs
      JOIN (
        SELECT DISTINCT ON (j.collection_source_id) j.collection_source_id,j.id,j.status,j.next_run_at,j.lease_until
        FROM source_collection_job j WHERE j.status IN ('queued','retrying','running')
        ORDER BY j.collection_source_id,
          (j.status='running' OR COALESCE(j.provider_state->>'phase' IN ('starting','running','reading'),FALSE)) DESC,j.created_at,j.id
      ) head ON head.collection_source_id=cs.id AND head.next_run_at<=NOW() AND (head.status<>'running' OR head.lease_until<NOW())
      WHERE cs.state='active' AND cs.delivery_mode='pull' AND NOT cs.automatic_collection_blocked
      ORDER BY head.next_run_at,cs.id FOR UPDATE OF cs SKIP LOCKED LIMIT 1`)
    ).rows[0];
    if (!candidate) return null;
    const source = await lockSource(client, workerActor, candidate.id);
    const job = (
      await client.query(
        `SELECT * FROM source_collection_job WHERE id=$1 AND next_run_at<=NOW()
         AND (status IN ('queued','retrying') OR status='running' AND lease_until<NOW()) FOR UPDATE`,
        [candidate.job_id],
      )
    ).rows[0];
    if (!job) return null;
    const token = randomUUID();
    await client.query(
      "UPDATE source_collection_job SET status='running',lease_token=$2,lease_until=NOW()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
      [job.id, token],
    );
    return { source, job, token };
  });
  if (!claim) return false;
  const { source, job, token } = claim;
  const provider = providers.find(
    (item) =>
      item.capability.provider === job.provider &&
      item.capability.platform === source.platform,
  );
  const saveState = async (state: JsonValue) =>
    transaction(pool, async (client) => {
      await lockSource(client, workerActor, source.id);
      const updated = await client.query(
        "UPDATE source_collection_job SET provider_state=$3,provider_run_id=$3::jsonb->>'runId',lease_until=NOW()+interval '2 minutes' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
        [job.id, token, state],
      );
      if (!updated.rowCount) fail(409, "Collection lease lost");
      job.provider_state = state;
    });
  try {
    if (!provider?.capability.enabled) fail(422, "Provider is disabled");
    const phase = job.provider_state.phase;
    if (
      job.page_request_attempts >= 3 &&
      !["running", "reading"].includes(phase)
    )
      fail(409, "Page request attempt limit reached");
    if (
      phase === "unknown" ||
      (phase === "starting" &&
        !job.provider_state.runId &&
        provider.capability.automaticRequestReplay === false)
    )
      fail(409, "Unresolved paid request; inspect provider console");
    if (
      !phase ||
      (phase === "starting" &&
        provider.capability.automaticRequestReplay !== false)
    ) {
      const hydrate = job.operation === "hydrate";
      const refresh = Array.isArray(job.request_json.externalIds);
      const resources = refresh ? job.page_size : hydrate
        ? job.page_size + 1
        : ["twitterapis", "scrapebadger"].includes(job.provider)
          ? (provider.capability.requestResourceUpperBound ?? 20)
          : Math.min(2000, job.page_size *
              (job.request_json.includeComments ? (job.request_json.maxCommentsPerPost ?? 15) + 1 : 1) + 1);
      const admitted = await transaction(pool, async (client) => {
        await lockSource(client, workerActor, source.id);
        const budget = (
          await client.query(
            "SELECT * FROM source_provider_budget WHERE provider=$1 FOR UPDATE",
            [job.provider],
          )
        ).rows[0];
        const usage = (
          await client.query(
            `SELECT COALESCE(SUM(requests),0) AS requests,COALESCE(SUM(resources_reserved),0) AS resources,COALESCE(SUM(requests) FILTER(WHERE day=(NOW() AT TIME ZONE 'UTC')::date),0) AS daily_requests,COALESCE(SUM(resources_reserved) FILTER(WHERE day=(NOW() AT TIME ZONE 'UTC')::date),0) AS daily_resources FROM source_provider_usage WHERE provider=$1 AND day>=date_trunc('month',NOW() AT TIME ZONE 'UTC')::date`,
            [job.provider],
          )
        ).rows[0];
        if (
          !budget?.enabled ||
          Number(usage.requests) + 1 > budget.monthly_requests ||
          Number(usage.daily_requests) + 1 > budget.daily_requests ||
          Number(usage.resources) + resources > budget.monthly_resources ||
          Number(usage.daily_resources) + resources > budget.daily_resources ||
          (budget.last_request_at &&
            Date.now() - budget.last_request_at.getTime() <
              budget.minimum_interval_ms)
        )
          return false;
        const updated = await client.query(
          `UPDATE source_collection_job SET provider_state='{"phase":"starting"}',request_count=request_count+1,page_request_attempts=page_request_attempts+1 WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id`,
          [job.id, token],
        );
        if (!updated.rowCount) fail(409, "Collection lease lost");
        await client.query(
          `INSERT INTO source_provider_usage(provider,day,requests,resources_reserved) VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,1,$2) ON CONFLICT(provider,day) DO UPDATE SET requests=source_provider_usage.requests+1,resources_reserved=source_provider_usage.resources_reserved+EXCLUDED.resources_reserved`,
          [job.provider, resources],
        );
        await client.query(
          "UPDATE source_provider_budget SET last_request_at=NOW() WHERE provider=$1",
          [job.provider],
        );
        return true;
      });
      if (!admitted) {
        await pool.query(
          "UPDATE source_collection_job SET status='queued',next_run_at=NOW()+interval '1 minute',lease_token=NULL,lease_until=NULL,error='Budget disabled, exhausted or request spacing' WHERE id=$1 AND lease_token=$2",
          [job.id, token],
        );
        return true;
      }
      job.provider_state = { phase: "starting" };
      job.page_request_attempts++;
    }
    const collectionSource = { ...sourceFromRow(source), primaryProvider: job.provider };
    const externalIds = job.request_json.externalIds;
    if (job.operation === "hydrate" && !externalIds) {
      collectionSource.target = { type: "post", postId: job.request_json.postId };
      collectionSource.contentKind = "comment";
    }
    if (externalIds && !provider.refreshIds) fail(422, "Provider does not support ID refresh");
    const checkpoint = job.provider === "feed" ? (await pool.query(
      `SELECT checkpoint FROM source_collection_job WHERE collection_source_id=$1 AND provider='feed' AND status='succeeded'
       ORDER BY created_at DESC LIMIT 1`,
      [source.id],
    )).rows[0]?.checkpoint ?? null : job.checkpoint;
    const page = externalIds
      ? await provider.refreshIds!({ source: collectionSource, externalIds, signal })
      : await provider.collectPage({
          source: collectionSource,
          from: job.from_at.toISOString(),
          to: job.to_at.toISOString(),
          limit: job.page_size,
          checkpoint,
          signal,
          includeComments: job.request_json.includeComments,
          commentSort: job.operation === "hydrate" ? "top" : undefined,
          maxCommentsPerPost: job.request_json.maxCommentsPerPost,
          execution: { state: job.provider_state, saveState },
        });
    if (page.pending) {
      await pool.query(
        "UPDATE source_collection_job SET status='queued',next_run_at=NOW()+interval '2 seconds',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",
        [job.id, token],
      );
      return true;
    }
    const batch = prepareContentBatch(page.items);
    await transaction(pool, async (client) => {
      await lockSource(client, workerActor, source.id);
      const current = (
        await client.query(
          "SELECT * FROM source_collection_job WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>NOW() FOR UPDATE",
          [job.id, token],
        )
      ).rows[0];
      if (!current) fail(409, "Collection lease lost");
      const counts = await commitContentBatch(
        client,
        {
          id: source.id,
          platformId: source.platform_id,
          platform: source.platform,
          provider: job.provider,
          contentKinds: provider.capability.contentKinds,
        },
        batch,
        new Date().toISOString(),
      );
      await client.query(
        `UPDATE source_collection_job SET status='succeeded',provider_state=provider_state||'{"phase":"committed"}',checkpoint=$3,pages_committed=pages_committed+1,records_processed=$4,records_inserted=$5,records_updated=$6,result_summary=$8,coverage='partial',exhausted=$7,finished_at=NOW(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,
        [
          job.id,
          token,
          page.nextCheckpoint,
          page.items.length,
          counts.added,
          counts.updated,
          page.exhausted,
          page.creditsUsed === undefined ? null : { creditsUsed: page.creditsUsed },
        ],
      );
      await client.query(
        `UPDATE collection_source SET last_checked_at=NOW(),coverage='partial',
           last_success_at=CASE WHEN $4 THEN last_success_at ELSE NOW() END,
           incremental_to=CASE WHEN $3 THEN GREATEST(incremental_to,$2) ELSE incremental_to END WHERE id=$1`,
        [source.id, job.to_at, page.exhausted && job.operation !== "hydrate", page.notModified ?? false],
      );
    });
  } catch (error) {
    await transaction(pool, async (client) => {
      await client.query(
        "SELECT id FROM collection_source WHERE id=$1 FOR UPDATE",
        [source.id],
      );
      const current = (
        await client.query(
          "SELECT provider_state FROM source_collection_job WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE",
          [job.id, token],
        )
      ).rows[0];
      if (!current) return;
      if (signal?.aborted) {
        await client.query(
          "UPDATE source_collection_job SET status='queued',next_run_at=NOW(),lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2",
          [job.id, token],
        );
        return;
      }
      const retryable =
        provider?.capability.automaticRequestReplay !== false &&
        error !== null &&
        typeof error === "object" &&
        "retryable" in error &&
        error.retryable === true &&
        job.page_request_attempts < 3;
      if (retryable) {
        await client.query(
          "UPDATE source_collection_job SET status='retrying',provider_state='{}',next_run_at=NOW()+interval '30 seconds',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",
          [job.id, token],
        );
        return;
      }
      const httpStatus = error instanceof ContentProviderError ? error.httpStatus : undefined;
      const rejected = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408;
      // ScrapeBadger documents zero credits for failed HTTP responses. Apify
      // can lose a run receipt after accepting the POST, including on a 5xx.
      const uncharged = rejected || (job.provider === "scrapebadger" && httpStatus !== undefined && httpStatus >= 500);
      const phase = current.provider_state.phase;
      const unknown = phase === "unknown" ||
        (provider?.capability.automaticRequestReplay === false && phase === "starting" && !uncharged);
      await client.query(
        "UPDATE source_collection_job SET status='failed',error=$3,provider_state=provider_state||$4::jsonb,finished_at=NOW(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2",
        [
          job.id,
          token,
          error instanceof Error ? error.message : "Collection failed",
          JSON.stringify({
            phase: unknown
              ? "unknown"
              : (["running", "reading"].includes(phase) ? phase : "failed"),
          }),
        ],
      );
      if (unknown) await client.query(
        "UPDATE collection_source SET automatic_collection_blocked=TRUE WHERE id=$1",
        [source.id],
      );
    });
  }
  return true;
}

export function startWorker(pool: Pool, providers: ContentProvider[]) {
  const controller = new AbortController();
  const run = async () => {
    while (!controller.signal.aborted) {
      const worked = await workOnce(pool, providers, controller.signal).catch(
        () => false,
      );
      if (!worked)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, 1000);
          controller.signal.addEventListener("abort", done, { once: true });
        });
    }
  };
  const active = Promise.all([run(), run()]);
  return {
    stop: async () => {
      controller.abort();
      await active;
    },
  };
}
