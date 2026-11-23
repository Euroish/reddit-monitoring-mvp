import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { JsonValue } from "../../../packages/contracts/src/common";
import { ContentProviderError, type CollectedPage, type ContentProvider } from "../../connectors/shared/content-provider.interface";
import { createPgNotifier } from "../../platform/pg-notify";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { commitContentBatch, prepareContentBatch } from "../content/index";
import { budgetedSocialProviders, cancelHydrationOutsideBudget, lockSocialDispatchBudget } from "./automatic-hydration";
import { isViewerJobStillAuthorized, recordUserExecutedRequest, requestedCommentLimit } from "./policy";
import { scheduleDueSourcesOnce } from "./schedule";
import { lockSource, sourceFromRow } from "./sql";

const workerActor = { allowedSourceIds: null } as Actor;
const hostCooldownMs = 1500;
const cleanupIntervalMs = 3600_000;
const jobLeaseSeconds = 180; // Allow the supported 120s provider timeout plus local work.
const maxIdleWaitMs = 15_000;

function pruneCooldownHosts(hostCooldown?: Map<string, number>) {
  const cooledHosts: string[] = [];
  if (!hostCooldown) return cooledHosts;
  const nowMs = Date.now();
  for (const [host, until] of hostCooldown) {
    if (until <= nowMs) hostCooldown.delete(host);
    else cooledHosts.push(host);
  }
  return cooledHosts;
}

async function claimNextJob(pool: Pool, cooledHosts: string[], hostCooldown?: Map<string, number>) {
  return transaction(pool, async (client) => {
    const candidate = (
      await client.query(
        `SELECT cs.id,head.id AS job_id FROM collection_source cs
        JOIN (
          SELECT DISTINCT ON (j.collection_source_id) j.collection_source_id,j.id,j.status,j.next_run_at,j.lease_until
          FROM source_collection_job j WHERE j.status IN ('queued','retrying','running')
          ORDER BY j.collection_source_id,
            (j.status='running' OR COALESCE(j.provider_state->>'phase' IN ('starting','running','reading'),FALSE)) DESC,j.created_at,j.id
        ) head ON head.collection_source_id=cs.id AND head.next_run_at<=NOW() AND (head.status<>'running' OR head.lease_until<NOW())
        WHERE cs.state='active' AND cs.delivery_mode='pull' AND NOT cs.automatic_collection_blocked
          AND (cs.primary_provider<>'feed' OR (
            NOT (split_part(cs.target->>'url','/',3)=ANY($1::text[]))
            AND NOT EXISTS (
              SELECT 1 FROM source_collection_job j JOIN collection_source peer ON peer.id=j.collection_source_id
              WHERE j.provider='feed' AND j.status='running' AND j.lease_until>now() AND peer.id<>cs.id
                AND split_part(peer.target->>'url','/',3)=split_part(cs.target->>'url','/',3))
          ))
        ORDER BY head.next_run_at,cs.id FOR UPDATE OF cs SKIP LOCKED LIMIT 1`,
        [cooledHosts],
      )
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
    if (job.provider === "feed") {
      const host = new URL(source.target.url).hostname;
      if (hostCooldown && (hostCooldown.get(host) ?? 0) > Date.now()) return null;
      const { rows: [lock] } = await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
        [`feed:${host}`],
      );
      if (!lock.acquired) return null;
      const busy = await client.query(
        `SELECT 1 FROM source_collection_job j JOIN collection_source cs ON cs.id=j.collection_source_id
        WHERE j.provider='feed' AND j.status='running' AND j.lease_until>now() AND cs.id<>$1
          AND split_part(cs.target->>'url','/',3)=$2 LIMIT 1`,
        [source.id, host],
      );
      if (busy.rowCount) return null;
    }
    const token = randomUUID();
    await client.query(
      "UPDATE source_collection_job SET status='running',lease_token=$2,lease_until=NOW()+make_interval(secs=>$3),attempts=attempts+1 WHERE id=$1",
      [job.id, token, jobLeaseSeconds],
    );
    return { source, job, token };
  });
}

function estimateResources(job: QueryResultRow, source: QueryResultRow, provider: ContentProvider) {
  const hydrate = job.operation === "hydrate";
  const refresh = Array.isArray(job.request_json.externalIds);
  const threadRequest = hydrate || (job.provider === "kaix" && source.target.type === "post");
  if (refresh) return job.page_size;
  if (threadRequest) return 1 + Math.min(job.page_size, job.request_json.maxCommentsPerPost ?? 50);
  if (["twitterapis", "scrapebadger"].includes(job.provider)) {
    return provider.capability.requestResourceUpperBound ?? 20;
  }
  return Math.min(
    2000,
    job.page_size * (job.request_json.includeComments ? (job.request_json.maxCommentsPerPost ?? 15) + 1 : 1) + 1,
  );
}

async function admitJobDispatch(
  pool: Pool,
  job: QueryResultRow & {
    requested_by_user_id: string | null;
    requested_by_client_kind: string | null;
    provider: string;
    collection_source_id: string;
    page_size: number;
  },
  source: QueryResultRow,
  provider: ContentProvider,
  token: string,
) {
  const resources = estimateResources(job, source, provider);
  const refresh = Array.isArray(job.request_json.externalIds);
  const hydrate = job.operation === "hydrate";
  return transaction(pool, async (client) => {
    const currentSource = await lockSource(client, workerActor, source.id);
    if (job.purpose === "scheduled" && !currentSource.schedule.enabled) {
      await client.query(
        `UPDATE source_collection_job SET status='cancelled',finished_at=now(),
          lease_token=NULL,lease_until=NULL,attempts=attempts-1 WHERE id=$1 AND lease_token=$2`,
        [job.id, token],
      );
      return false;
    }
    const commentLimit = refresh
      ? undefined
      : requestedCommentLimit(job.provider, hydrate ? "post" : currentSource.target.type, job.page_size, job.request_json);
    if (!(await isViewerJobStillAuthorized(client, job, commentLimit))) {
      await client.query(
        `UPDATE source_collection_job SET status='cancelled',finished_at=now(),
          lease_token=NULL,lease_until=NULL,error='Collection policy revoked before dispatch'
        WHERE id=$1 AND lease_token=$2`,
        [job.id, token],
      );
      return false;
    }
    if (budgetedSocialProviders.includes(job.provider)) await lockSocialDispatchBudget(client);
    await client.query("SELECT 1 FROM source_provider_budget WHERE provider=$1 FOR UPDATE", [job.provider]);
    if (job.request_json.autoMonitorId && (await cancelHydrationOutsideBudget(client, job.id, token, resources))) return false;
    const deferred = await client.query(
      `UPDATE source_collection_job SET status='queued',next_run_at=ready.at,lease_token=NULL,lease_until=NULL,
        attempts=attempts-1,error='Waiting for provider budget'
       FROM (SELECT provider_ready_at($3,$4) AS at) ready
       WHERE id=$1 AND lease_token=$2 AND ready.at>now()`,
      [job.id, token, job.provider, resources],
    );
    if (deferred.rowCount) return false;
    const updated = await client.query(
      `UPDATE source_collection_job SET provider_state='{"phase":"starting"}',error=NULL,
        request_count=request_count+1,page_request_attempts=page_request_attempts+1,lease_until=NOW()+make_interval(secs=>$3)
       WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id`,
      [job.id, token, jobLeaseSeconds],
    );
    if (!updated.rowCount) fail(409, "Collection lease lost");
    await client.query(
      `INSERT INTO source_provider_usage(provider,day,requests,resources_reserved)
       VALUES($1,(NOW() AT TIME ZONE 'UTC')::date,1,$2)
       ON CONFLICT(provider,day) DO UPDATE SET requests=source_provider_usage.requests+1,
         resources_reserved=source_provider_usage.resources_reserved+EXCLUDED.resources_reserved`,
      [job.provider, resources],
    );
    await client.query("UPDATE source_provider_budget SET last_request_at=NOW() WHERE provider=$1", [job.provider]);
    await recordUserExecutedRequest(client, job.id, job.provider);
    return true;
  });
}

function computeNextScheduleInterval(
  job: QueryResultRow,
  schedule: { cadenceSeconds?: number; intervalSeconds?: number },
  page: CollectedPage,
  addedCount: number,
) {
  const cadence = schedule.cadenceSeconds ?? 3600;
  const previous = schedule.intervalSeconds ?? cadence;
  if (page.warning || job.provider === "newsnow") return cadence;
  if (!page.exhausted) return job.provider === "feed" ? cadence : Math.max(120, Math.floor(previous / 2));
  if (page.notModified || job.records_inserted + addedCount === 0) return Math.min(14400, Math.ceil(previous * 1.25));
  return cadence;
}

async function commitCollectedPage(
  client: PoolClient,
  job: QueryResultRow,
  source: QueryResultRow,
  provider: ContentProvider,
  token: string,
  page: CollectedPage,
  batch: ReturnType<typeof prepareContentBatch>,
  elapsedMs: number,
) {
  const finishingSource = await lockSource(client, workerActor, source.id, false);
  const current = (
    await client.query(
      "SELECT * FROM source_collection_job WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>NOW() FOR UPDATE",
      [job.id, token],
    )
  ).rows[0];
  if (!current) fail(409, "Collection lease lost");
  const counts = await commitContentBatch(
    client,
    { id: source.id, platformId: source.platform_id, platform: source.platform, provider: job.provider, contentKinds: provider.capability.contentKinds },
    batch,
    new Date().toISOString(),
  );
  const scheduled = job.purpose === "scheduled";
  const nextPage =
    scheduled && finishingSource.state === "active" && finishingSource.schedule.enabled &&
    job.provider !== "feed" && page.nextCheckpoint !== null && job.pages_committed + 1 < job.max_pages;
  const summary = page.warning || page.creditsUsed !== undefined
    ? { warning: page.warning ?? undefined, creditsUsed: page.creditsUsed }
    : null;
  await client.query(
    `UPDATE source_collection_job SET status=CASE WHEN $9 THEN 'queued' ELSE 'succeeded' END,
      provider_state=CASE WHEN $9 THEN '{}' ELSE provider_state||'{"phase":"committed"}' END,
      provider_run_id=CASE WHEN $9 THEN NULL ELSE provider_run_id END,
      page_request_attempts=CASE WHEN $9 THEN 0 ELSE page_request_attempts END,
      checkpoint=$3,pages_committed=pages_committed+1,records_processed=records_processed+$4,
      records_inserted=records_inserted+$5,records_updated=records_updated+$6,result_summary=$8,
      coverage='partial',exhausted=$7,finished_at=CASE WHEN NOT $9 THEN now() END,
      lease_token=NULL,lease_until=NULL,next_run_at=now(),
      request_duration_ms=request_duration_ms+$10 WHERE id=$1 AND lease_token=$2`,
    [job.id, token, page.nextCheckpoint, page.items.length, counts.added, counts.updated, page.exhausted, summary, nextPage, elapsedMs],
  );
  const interval = computeNextScheduleInterval(job, finishingSource.schedule, page, counts.added);
  const advanceCursor = (page.exhausted || (job.provider === "feed" && page.items.length > 0)) && job.operation !== "hydrate";
  const updateSchedule = scheduled && !nextPage && finishingSource.schedule.enabled && finishingSource.state === "active";
  await client.query(
    `UPDATE collection_source SET last_checked_at=now(),coverage='partial',
      last_success_at=CASE WHEN $4 THEN last_success_at ELSE now() END,
      incremental_to=CASE WHEN $3 THEN GREATEST(incremental_to,$2) ELSE incremental_to END,
      next_due_at=CASE WHEN $5 THEN now()+make_interval(secs => $6) ELSE next_due_at END,
      schedule=CASE WHEN $5 THEN schedule||jsonb_build_object('intervalSeconds',$6::int) ELSE schedule END,
      http_etag=COALESCE($7::text,http_etag),
      http_last_modified=COALESCE($8::text,http_last_modified),
      health=COALESCE(health,'{}'::jsonb)||jsonb_build_object(
        'consecutiveFailures',0,'lastError',NULL,'lastStatus','succeeded',
        'lastDurationMs',$9::double precision,'lastTruncated',$10::boolean,'lastNotModified',$4::boolean,
        'lastFetchedCount',$11::int,'lastInsertedCount',$12::int,
        'totalRuns',COALESCE((health->>'totalRuns')::int,0)+1,
        'truncatedRuns',COALESCE((health->>'truncatedRuns')::int,0)+CASE WHEN $10::boolean THEN 1 ELSE 0 END,
        'notModifiedRuns',COALESCE((health->>'notModifiedRuns')::int,0)+CASE WHEN $4::boolean THEN 1 ELSE 0 END
      ) WHERE id=$1`,
    [
      source.id, job.to_at, advanceCursor, page.notModified ?? false, updateSchedule, interval,
      page.httpEtag ?? null, page.httpLastModified ?? null, elapsedMs, !page.exhausted, page.items.length, counts.added,
    ],
  );
  return counts.added + counts.updated > 0;
}

function isTransientCollectionError(error: unknown) {
  if (error instanceof ContentProviderError) return error.retryable;
  return error instanceof TypeError || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
}

function findFallbackProvider(
  providers: ContentProvider[],
  job: QueryResultRow,
  failedSource: QueryResultRow,
  phase: string,
  hasRunId: boolean,
  httpStatus: number | undefined,
) {
  if (
    job.purpose !== "scheduled" ||
    failedSource.state !== "active" ||
    !failedSource.schedule.enabled ||
    job.provider !== failedSource.primary_provider ||
    job.pages_committed !== 0 ||
    phase !== "starting" ||
    hasRunId ||
    httpStatus !== 429
  ) {
    return undefined;
  }
  return providers.find(
    ({ capability }) =>
      capability.enabled &&
      capability.provider === failedSource.fallback_provider &&
      capability.platform === failedSource.platform,
  );
}

function classifyJobFailure(
  providers: ContentProvider[],
  job: QueryResultRow,
  failedSource: QueryResultRow,
  provider: ContentProvider | undefined,
  phase: string,
  hasRunId: boolean,
  error: unknown,
) {
  const httpStatus = error instanceof ContentProviderError ? error.httpStatus : undefined;
  const hasRun = (phase === "running" || phase === "reading") && hasRunId;
  const transient = isTransientCollectionError(error);
  const retryStart = provider?.capability.automaticRequestReplay !== false && transient && job.page_request_attempts < 3;
  const retryRead = hasRun && (transient || httpStatus === 429 || (httpStatus ?? 0) >= 500);
  const rejected = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408;
  const uncharged = rejected || (job.provider === "scrapebadger" && (httpStatus ?? 0) >= 500);
  const fallback = findFallbackProvider(providers, job, failedSource, phase, hasRunId, httpStatus);
  const unknown = phase === "unknown" || (provider?.capability.automaticRequestReplay === false && phase === "starting" && !uncharged);
  return { retryStart, retryRead, fallback, unknown };
}

async function handleJobError(
  client: PoolClient,
  providers: ContentProvider[],
  job: QueryResultRow,
  source: QueryResultRow,
  provider: ContentProvider | undefined,
  token: string,
  error: unknown,
  elapsedMs: number,
  signal?: AbortSignal,
) {
  const failedSource = await lockSource(client, workerActor, source.id, false);
  const current = (
    await client.query("SELECT provider_state FROM source_collection_job WHERE id=$1 AND lease_token=$2 AND status='running' FOR UPDATE", [
      job.id, token,
    ])
  ).rows[0];
  if (!current) return;
  if (signal?.aborted) {
    await client.query(
      "UPDATE source_collection_job SET status='queued',next_run_at=NOW(),lease_token=NULL,lease_until=NULL,error=NULL WHERE id=$1 AND lease_token=$2",
      [job.id, token],
    );
    return;
  }
  const phase = current.provider_state.phase as string;
  const plan = classifyJobFailure(providers, job, failedSource, provider, phase, Boolean(current.provider_state.runId), error);
  if (plan.retryStart || plan.retryRead) {
    const retryAfter = error instanceof ContentProviderError ? error.retryAfterSeconds : 30;
    await client.query(
      `UPDATE source_collection_job SET status='retrying',provider_state=CASE WHEN $4 THEN provider_state ELSE '{}' END,next_run_at=now()+make_interval(secs => $3),
        lease_token=NULL,lease_until=NULL,request_duration_ms=request_duration_ms+$5 WHERE id=$1 AND lease_token=$2`,
      [job.id, token, retryAfter, plan.retryRead, elapsedMs],
    );
    return;
  }
  if (plan.fallback) {
    await client.query(
      `UPDATE source_collection_job SET provider=$3,status='queued',provider_state='{}',provider_run_id=NULL,
        page_request_attempts=0,lease_token=NULL,lease_until=NULL,next_run_at=now(),error=NULL,
        request_duration_ms=request_duration_ms+$4 WHERE id=$1 AND lease_token=$2`,
      [job.id, token, plan.fallback.capability.provider, elapsedMs],
    );
    return;
  }
  const errorMessage = error instanceof Error ? error.message : "Collection failed";
  const nextPhase = plan.unknown ? "unknown" : phase === "running" || phase === "reading" ? phase : "failed";
  await client.query(
    `UPDATE source_collection_job SET status='failed',error=$3,provider_state=provider_state||$4::jsonb,
      finished_at=NOW(),lease_token=NULL,lease_until=NULL,request_duration_ms=request_duration_ms+$5
     WHERE id=$1 AND lease_token=$2`,
    [job.id, token, errorMessage, JSON.stringify({ phase: nextPhase }), elapsedMs],
  );
  await client.query(
    `UPDATE collection_source SET
      automatic_collection_blocked=CASE WHEN $4 THEN TRUE ELSE automatic_collection_blocked END,
      health=COALESCE(health,'{}'::jsonb)||jsonb_build_object(
        'consecutiveFailures',COALESCE((health->>'consecutiveFailures')::int,0)+1,
        'lastError',$2::text,'lastStatus','failed','lastDurationMs',$3::double precision,
        'totalRuns',COALESCE((health->>'totalRuns')::int,0)+1
      ) WHERE id=$1`,
    [source.id, errorMessage, elapsedMs, plan.unknown],
  );
}

async function fetchProviderPage(
  pool: Pool,
  job: QueryResultRow,
  source: QueryResultRow,
  provider: ContentProvider,
  saveState: (state: JsonValue) => Promise<void>,
  signal?: AbortSignal,
) {
  const collectionSource = {
    ...sourceFromRow(source),
    primaryProvider: job.provider,
    fetchPolicy: source.fetch_policy ?? {},
  };
  const externalIds = job.request_json.externalIds;
  if (job.operation === "hydrate" && !externalIds) {
    collectionSource.target = { type: "post", postId: job.request_json.postId };
    collectionSource.contentKind = "comment";
  }
  if (externalIds && !provider.refreshIds) fail(422, "Provider does not support ID refresh");
  const checkpoint =
    job.provider === "feed"
      ? ((
          await pool.query(
            "SELECT checkpoint FROM source_collection_job WHERE collection_source_id=$1 AND provider='feed' AND status='succeeded' ORDER BY created_at DESC LIMIT 1",
            [source.id],
          )
        ).rows[0]?.checkpoint ?? null)
      : job.checkpoint;
  return externalIds
    ? provider.refreshIds!({ source: collectionSource, externalIds, signal })
    : provider.collectPage({
        source: collectionSource,
        from: job.from_at.toISOString(),
        to: job.to_at.toISOString(),
        limit: job.page_size,
        checkpoint,
        httpEtag: source.http_etag ?? null,
        httpLastModified: source.http_last_modified ?? null,
        signal,
        includeComments: job.request_json.includeComments,
        commentSort: job.operation === "hydrate" ? "top" : undefined,
        maxCommentsPerPost: job.request_json.maxCommentsPerPost,
        execution: { state: job.provider_state, saveState },
      });
}

function assertProviderReadyForJob(job: QueryResultRow, provider: ContentProvider | undefined): asserts provider is ContentProvider {
  if (!provider?.capability.enabled) fail(422, "Provider is disabled");
  const phase = job.provider_state.phase;
  if (job.page_request_attempts >= 3 && phase !== "running" && phase !== "reading") {
    fail(409, "Page request attempt limit reached");
  }
  if (phase === "unknown" || (phase === "starting" && !job.provider_state.runId && provider.capability.automaticRequestReplay === false)) {
    fail(409, "Unresolved paid request; inspect provider console");
  }
}

type BatchCommittedHook = (sourceId: string, result: { changed: boolean; hydration: boolean }) => void | Promise<void>;

export async function workOnce(
  pool: Pool,
  providers: ContentProvider[],
  signal?: AbortSignal,
  hostCooldown?: Map<string, number>,
  onBatchCommitted?: BatchCommittedHook,
) {
  if (signal?.aborted) return false;
  const claim = await claimNextJob(pool, pruneCooldownHosts(hostCooldown), hostCooldown);
  if (!claim) return false;
  const { source, job, token } = claim;
  const provider = providers.find((item) => item.capability.provider === job.provider && item.capability.platform === source.platform);
  const saveState = async (state: JsonValue) =>
    transaction(pool, async (client) => {
      await lockSource(client, workerActor, source.id, false);
      const updated = await client.query(
        "UPDATE source_collection_job SET provider_state=$3,provider_run_id=$3::jsonb->>'runId',lease_until=NOW()+make_interval(secs=>$4) WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
        [job.id, token, state, jobLeaseSeconds],
      );
      if (!updated.rowCount) fail(409, "Collection lease lost");
      job.provider_state = state;
    });
  let elapsedMs = 0;
  const feedHost = job.provider === "feed" ? new URL(source.target.url).hostname : null;
  try {
    assertProviderReadyForJob(job, provider);
    const phase = job.provider_state.phase;
    if (!phase || (phase === "starting" && provider.capability.automaticRequestReplay !== false)) {
      const admitted = await admitJobDispatch(pool, job as Parameters<typeof admitJobDispatch>[1], source, provider, token);
      if (!admitted) return true;
      job.provider_state = { phase: "starting" };
      job.page_request_attempts++;
    }
    const reqStart = performance.now();
    if (feedHost && hostCooldown) hostCooldown.set(feedHost, Date.now() + hostCooldownMs);
    let page: CollectedPage;
    try {
      page = await fetchProviderPage(pool, job, source, provider, saveState, signal);
    } finally {
      elapsedMs = Math.max(0, Math.round((performance.now() - reqStart) * 10) / 10);
      if (feedHost && hostCooldown) hostCooldown.set(feedHost, Date.now() + hostCooldownMs);
    }
    if (page.pending) {
      await pool.query(
        "UPDATE source_collection_job SET status='queued',next_run_at=NOW()+interval '2 seconds',lease_token=NULL,lease_until=NULL,request_duration_ms=request_duration_ms+$3 WHERE id=$1 AND lease_token=$2",
        [job.id, token, elapsedMs],
      );
      return true;
    }
    const batch = prepareContentBatch(page.items);
    const dirty = await transaction(pool, (client) => commitCollectedPage(client, job, source, provider, token, page, batch, elapsedMs));
    if (onBatchCommitted && (dirty || source.target.type === "community")) {
      await Promise.resolve().then(() => onBatchCommitted(source.id, {
        changed: dirty,
        hydration: job.operation === "hydrate",
      })).catch(() => {});
    }
  } catch (error) {
    await transaction(pool, (client) => handleJobError(client, providers, job, source, provider, token, error, elapsedMs, signal));
  }
  return true;
}

async function computeIdleWaitMs(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ wait_ms: number | null }>(
    `SELECT LEAST(
       (SELECT EXTRACT(EPOCH FROM (MIN(next_run_at) - now())) * 1000
        FROM source_collection_job WHERE status IN ('queued','retrying')),
       (SELECT EXTRACT(EPOCH FROM (MIN(next_due_at) - now())) * 1000
        FROM collection_source
        WHERE state='active' AND delivery_mode='pull' AND NOT automatic_collection_blocked
          AND schedule @> '{"enabled":true}')
     )::double precision AS wait_ms`,
  );
  const raw = rows[0]?.wait_ms;
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return maxIdleWaitMs;
  if (raw <= 0) return 5_000;
  return Math.min(maxIdleWaitMs, Math.max(500, Math.ceil(raw)));
}

export function startWorker(pool: Pool, providers: ContentProvider[], onError?: (error: unknown) => void, onBatchCommitted?: BatchCommittedHook) {
  const controller = new AbortController();
  const startedAt = new Date();
  const hostCooldown = new Map<string, number>();
  const concurrency = Math.min(12, Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 6) || 6));
  const waiters = new Set<() => void>();
  const wakeAll = () => {
    for (const resolve of [...waiters]) {
      waiters.delete(resolve);
      resolve();
    }
  };
  const waitForWake = (ms: number) =>
    new Promise<void>((resolve) => {
      if (controller.signal.aborted) {
        resolve();
        return;
      }
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        waiters.delete(done);
        controller.signal.removeEventListener("abort", done);
        resolve();
      };
      waiters.add(done);
      controller.signal.addEventListener("abort", done, { once: true });
      timer = setTimeout(done, ms);
      timer.unref();
    });

  const connStr = (pool as { options?: { connectionString?: string } }).options?.connectionString ?? process.env.DATABASE_URL;
  const notifier = createPgNotifier(connStr, "collection_jobs_ready", wakeAll, onError);

  const heartbeat = (state: "active" | "stopped") =>
    pool.query(
      `INSERT INTO source_worker_heartbeat(id,started_at,last_heartbeat_at,state)
       VALUES('unified-collection',$1,now(),$2)
       ON CONFLICT (id) DO UPDATE SET started_at=EXCLUDED.started_at,last_heartbeat_at=EXCLUDED.last_heartbeat_at,state=EXCLUDED.state
       WHERE source_worker_heartbeat.started_at<=EXCLUDED.started_at`,
      [startedAt, state],
    ).catch((error) => onError?.(error));

  const cleanupOldJobs = () =>
    pool.query(
      `WITH ranked AS (
         SELECT id,status,finished_at,created_at,
           ROW_NUMBER() OVER (PARTITION BY collection_source_id ORDER BY finished_at DESC NULLS LAST,created_at DESC) AS rn
         FROM source_collection_job
       )
       DELETE FROM source_collection_job j USING ranked r
       WHERE j.id=r.id AND r.rn>5 AND r.status IN ('succeeded','failed','cancelled')
         AND COALESCE(r.finished_at,r.created_at)<now()-interval '14 days'
         AND j.request_key IS NULL AND j.ingest_key IS NULL
         AND COALESCE(j.provider_state->>'phase','') NOT IN ('starting','unknown','running','reading')
         AND NOT EXISTS (
           SELECT 1 FROM source_collection_job child
           WHERE child.parent_job_id=j.id OR child.fallback_of_job_id=j.id
         )`,
    ).catch((error) => onError?.(error));

  let cleanupAt = 0;
  const reportLiveness = async () => {
    while (!controller.signal.aborted) {
      await heartbeat("active");
      if (Date.now() >= cleanupAt) {
        cleanupAt = Date.now() + cleanupIntervalMs;
        await cleanupOldJobs();
      }
      await sleep(30000, undefined, { signal: controller.signal }).catch(() => {});
    }
  };

  const run = async (leader: boolean) => {
    let scanAt = 0;
    while (!controller.signal.aborted) {
      if (leader && Date.now() >= scanAt) {
        scanAt = Date.now() + 5000;
        const scheduled = await scheduleDueSourcesOnce(pool, providers).catch((error) => {
          onError?.(error);
          return { enqueuedCount: 0 };
        });
        if (scheduled.enqueuedCount > 0) wakeAll();
      }
      const worked = await workOnce(pool, providers, controller.signal, hostCooldown, onBatchCommitted).catch((error) => {
        onError?.(error);
        return false;
      });
      if (!worked) {
        const waitMs = leader ? await computeIdleWaitMs(pool).catch(() => maxIdleWaitMs) : maxIdleWaitMs;
        await waitForWake(waitMs);
      }
    }
  };

  const active = Promise.all([reportLiveness(), run(true), ...Array.from({ length: concurrency - 1 }, () => run(false))]);
  return {
    stop: async () => {
      controller.abort();
      wakeAll();
      await notifier.close();
      await active;
      await heartbeat("stopped");
    },
  };
}
