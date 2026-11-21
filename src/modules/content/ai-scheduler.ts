import type { Pool } from "pg";
import { archiveLowValueCandidates, runOfficialEventDiscovery } from "./ai-discovery";
import { syncRegistrySourceByCode, type SyncFetcher } from "./ai-sync";

export async function runDueAiSyncSources(
  pool: Pool,
  options: { fetcher?: SyncFetcher; includeArtificialAnalysis?: boolean } = {},
): Promise<{ executed: string[]; failed: Array<{ code: string; error: string }> }> {
  const dueRes = await pool.query<{ id: string; code: string; kind: string; sync_interval_seconds: number }>(
    `SELECT id, code, kind, sync_interval_seconds
     FROM ai_registry_source
     WHERE enabled = TRUE
       AND (next_run_at IS NULL OR next_run_at <= NOW())
       AND (circuit_open_until IS NULL OR circuit_open_until <= NOW())
     ORDER BY COALESCE(next_run_at, TO_TIMESTAMP(0)) ASC`,
  );

  const executed: string[] = [];
  const failed: Array<{ code: string; error: string }> = [];
  const hasAaKey = options.includeArtificialAnalysis ?? Boolean(process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim());

  for (const src of dueRes.rows) {
    if (src.kind === "epoch") continue;
    if (src.kind === "artificial_analysis" && !hasAaKey) continue;

    try {
      if (src.kind === "official_feed") {
        await runOfficialEventDiscovery(pool);
        await archiveLowValueCandidates(pool, 24);
        await pool.query(
          `UPDATE ai_registry_source
           SET last_success_at = NOW(), consecutive_failures = 0, backoff_seconds = 0,
               circuit_open_until = NULL, last_error = NULL,
               next_run_at = NOW() + make_interval(secs => sync_interval_seconds), updated_at = NOW()
           WHERE id = $1`,
          [src.id],
        );
        await pool.query(
          `UPDATE ai_ops_alert SET resolved_at = NOW() WHERE source_code = $1 AND resolved_at IS NULL`,
          [src.code],
        );
      } else {
        await syncRegistrySourceByCode(pool, src.code, {
          triggerKind: "scheduled",
          fetcher: options.fetcher,
        });
      }
      executed.push(src.code);
    } catch (err) {
      failed.push({ code: src.code, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { executed, failed };
}

export function startAiSyncScheduler(pool: Pool): () => void {
  if (process.env.AI_SYNC_ENABLED !== "true") return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueAiSyncSources(pool);
    } catch {
      // Errors are recorded per-source in ai_registry_source and ai_ops_alert
    } finally {
      running = false;
    }
  };
  // Startup catch-up for overdue sources after 15s
  const startupTimer = setTimeout(() => { void tick(); }, 15_000);
  startupTimer.unref();
  // Per-source due check every 60s
  const pollTimer = setInterval(() => { void tick(); }, 60_000);
  pollTimer.unref();
  return () => {
    clearTimeout(startupTimer);
    clearInterval(pollTimer);
  };
}
