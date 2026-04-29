import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { ApiError, fetchApi } from '../api/client';
import { Card, Badge, Button, Input, Select } from '../components/ui';
import type {
  ApiReadinessResponse,
  ApiStorageObservabilityResponse,
  TriggerPhase1RunRequest,
  TriggerPhase1RunResponse,
} from '../../../../packages/contracts/src/http';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function Ops() {
  const [subreddit, setSubreddit] = useState('');
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [crawlMode, setCrawlMode] = useState<'live' | 'backfill'>('live');
  const [livePostLimit, setLivePostLimit] = useState('20');
  const [backfillPostLimit, setBackfillPostLimit] = useState('500');
  const [backfillMaxIterations, setBackfillMaxIterations] = useState('24');
  const [backfillTargetDays, setBackfillTargetDays] = useState('15');
  const [executionMode, setExecutionMode] = useState<'sync' | 'async'>('sync');

  useEffect(() => {
    setExecutionMode(mode === 'live' && crawlMode !== 'backfill' ? 'async' : 'sync');
  }, [mode, crawlMode]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['readyz'],
    queryFn: () => fetchApi<ApiReadinessResponse>('/v1/ops/readyz'),
  });
  const {
    data: storageData,
    isLoading: isStorageLoading,
    error: storageError,
    refetch: refetchStorage,
  } = useQuery({
    queryKey: ['ops-storage'],
    queryFn: () => fetchApi<ApiStorageObservabilityResponse>('/v1/ops/storage'),
  });

  const triggerRun = useMutation({
    mutationFn: (payload: TriggerPhase1RunRequest) =>
      fetchApi<TriggerPhase1RunResponse>('/v1/runs/reddit-phase1', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void refetch();
    },
  });

  const handleTriggerRun = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLivePostLimit = Number(livePostLimit);
    const normalizedBackfillPostLimit = Number(backfillPostLimit);
    const normalizedBackfillMaxIterations = Number(backfillMaxIterations);
    const normalizedBackfillTargetDays = Number(backfillTargetDays);

    triggerRun.mutate({
      mode,
      crawlMode,
      subreddit: subreddit.trim() || undefined,
      async: executionMode === 'async',
      postLimit:
        crawlMode !== 'backfill' &&
        Number.isInteger(normalizedLivePostLimit) &&
        normalizedLivePostLimit >= 1 &&
        normalizedLivePostLimit <= 3000
          ? normalizedLivePostLimit
          : undefined,
      backfillPostLimit:
        crawlMode === 'backfill' &&
        Number.isInteger(normalizedBackfillPostLimit) &&
        normalizedBackfillPostLimit >= 1 &&
        normalizedBackfillPostLimit <= 5000
          ? normalizedBackfillPostLimit
          : undefined,
      backfillMaxIterationsPerTarget:
        crawlMode === 'backfill' &&
        Number.isInteger(normalizedBackfillMaxIterations) &&
        normalizedBackfillMaxIterations >= 1 &&
        normalizedBackfillMaxIterations <= 120
          ? normalizedBackfillMaxIterations
          : undefined,
      backfillTargetDays:
        crawlMode === 'backfill' &&
        Number.isInteger(normalizedBackfillTargetDays) &&
        normalizedBackfillTargetDays >= 1 &&
        normalizedBackfillTargetDays <= 30
          ? normalizedBackfillTargetDays
          : undefined,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Operations</h1>
          <p className="page-subtitle">System readiness and guarded run controls</p>
        </div>
        <div className="filter-bar">
          <Link to="/ops/storage" className="markets-secondary-link">Storage</Link>
          <Link to="/ops/users" className="markets-secondary-link">Users</Link>
          <Link to="/ops/invites" className="markets-secondary-link">Invites</Link>
          <Button
            onClick={() => {
              void refetch();
              void refetchStorage();
            }}
            disabled={isLoading || isStorageLoading}
          >
            Refresh Status
          </Button>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading system status...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading ops data</div>}

      {data && (
        <div className="ops-grid">
          <Card>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              Overall Status
              <Badge variant={data.status === 'ready' ? 'success' : 'neutral'}>
                {data.status.toUpperCase()}
              </Badge>
            </h3>
            <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Active Sessions</div>
                <div className="kpi-value">{data.activeSessions}</div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Active Targets</div>
                <div className="kpi-value">{data.activeTargets}</div>
              </div>
            </div>
            {data.degradedReasons.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Degraded Reasons</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-tertiary)', fontSize: '13px' }}>
                  {data.degradedReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card>
            <h3 style={{ marginBottom: '16px' }}>Queue Backlog</h3>
            <div className="list-stack" style={{ gap: '12px' }}>
              <div className="list-row">
                <span style={{ color: 'var(--text-secondary)' }}>Live Backlog</span>
                <span style={{ fontWeight: 510 }}>{data.queue.byMode.live.backlog}</span>
              </div>
              <div className="list-row">
                <span style={{ color: 'var(--text-secondary)' }}>Backfill Backlog</span>
                <span style={{ fontWeight: 510 }}>{data.queue.byMode.backfill.backlog}</span>
              </div>
              <div className="list-row">
                <span style={{ color: 'var(--text-secondary)' }}>Default Backlog</span>
                <span style={{ fontWeight: 510 }}>{data.queue.byMode.default.backlog}</span>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '6px' }}>Storage Footprint</h3>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                Inspect current database size before widening retention or running backfills.
              </div>
            </div>

            {isStorageLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading storage snapshot...</div>}

            {storageError && (
              <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                {storageError instanceof ApiError && storageError.code === 'feature_not_ready'
                  ? 'Storage observability is not configured in this runtime.'
                  : 'Storage snapshot is unavailable right now.'}
              </div>
            )}

            {storageData && (
              <>
                <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginBottom: '18px' }}>
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Database Size</div>
                    <div className="kpi-value">{formatBytes(storageData.databaseSizeBytes)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Captured</div>
                    <div style={{ fontWeight: 510 }}>{new Date(storageData.capturedAtIso).toLocaleString()}</div>
                  </div>
                </div>

                <div className="list-stack" style={{ gap: '12px' }}>
                  {storageData.tables.slice(0, 5).map((table) => (
                    <div key={table.tableName} className="list-row" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 510 }}>{table.tableName}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                          ~{table.rowEstimate.toLocaleString()} rows
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 510 }}>{formatBytes(table.totalBytes)}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                          table {formatBytes(table.tableBytes)} · indexes {formatBytes(table.indexBytes)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>

          <Card>
            <h3 style={{ marginBottom: '8px' }}>Queue Phase 1 Run</h3>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '16px' }}>
              Use mock by default. Switch to live only when you need a real collection pass.
            </p>

            <form onSubmit={handleTriggerRun} className="list-stack" style={{ gap: '16px' }}>
              <div>
                <label htmlFor="ops-subreddit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Subreddit
                </label>
                <Input
                  id="ops-subreddit"
                  value={subreddit}
                  onChange={(event) => setSubreddit(event.target.value)}
                  placeholder="Optional, e.g. datascience"
                />
              </div>

              <div className="metric-grid">
                <div>
                  <label htmlFor="ops-mode" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Run mode
                  </label>
                  <Select
                    id="ops-mode"
                    value={mode}
                    onChange={(event) => setMode(event.target.value as 'mock' | 'live')}
                  >
                    <option value="mock">mock</option>
                    <option value="live">live</option>
                  </Select>
                </div>

                <div>
                  <label htmlFor="ops-crawl-mode" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Crawl mode
                  </label>
                  <Select
                    id="ops-crawl-mode"
                    value={crawlMode}
                    onChange={(event) => setCrawlMode(event.target.value as 'live' | 'backfill')}
                  >
                    <option value="live">live</option>
                    <option value="backfill">backfill</option>
                  </Select>
                </div>

                <div>
                  <label htmlFor="ops-execution-mode" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Execution
                  </label>
                  <Select
                    id="ops-execution-mode"
                    value={executionMode}
                    onChange={(event) => setExecutionMode(event.target.value as 'sync' | 'async')}
                  >
                    <option value="sync">sync</option>
                    <option value="async" disabled={crawlMode === 'backfill'}>async</option>
                  </Select>
                  {crawlMode === 'backfill' && (
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '6px' }}>
                      Backfill runs synchronously so cursor depth can advance until coverage or budget is reached.
                    </div>
                  )}
                </div>
              </div>

              {crawlMode === 'backfill' ? (
                <div>
                  <label htmlFor="ops-backfill-post-limit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Backfill post budget per iteration
                  </label>
                  <Input
                    id="ops-backfill-post-limit"
                    type="number"
                    min={1}
                    max={5000}
                    value={backfillPostLimit}
                    onChange={(event) => setBackfillPostLimit(event.target.value)}
                  />
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '6px' }}>
                    Backfill uses this as a per-iteration cursor budget; total depth is also bounded by max cursor iterations.
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="ops-live-post-limit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Live post limit
                  </label>
                  <Input
                    id="ops-live-post-limit"
                    type="number"
                    min={1}
                    max={3000}
                    value={livePostLimit}
                    onChange={(event) => setLivePostLimit(event.target.value)}
                  />
                </div>
              )}

              {crawlMode === 'backfill' && (
                <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                  <div>
                    <label htmlFor="ops-backfill-iterations" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      Max cursor iterations
                    </label>
                    <Input
                      id="ops-backfill-iterations"
                      type="number"
                      min={1}
                      max={120}
                      value={backfillMaxIterations}
                      onChange={(event) => setBackfillMaxIterations(event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="ops-backfill-days" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                      Target days
                    </label>
                    <Input
                      id="ops-backfill-days"
                      type="number"
                      min={1}
                      max={30}
                      value={backfillTargetDays}
                      onChange={(event) => setBackfillTargetDays(event.target.value)}
                    />
                  </div>
                </div>
              )}

              {triggerRun.error && (
                <div style={{ color: '#ff4d4f', fontSize: '13px' }}>
                  {triggerRun.error instanceof Error ? triggerRun.error.message : 'Run request failed'}
                </div>
              )}

              {triggerRun.data && (
                <div
                  style={{
                    border: '1px solid var(--border-standard)',
                    borderRadius: '6px',
                    padding: '12px 14px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <div style={{ marginBottom: '6px', fontWeight: 510 }}>
                    {executionMode === 'async' ? 'Run queued' : 'Run completed'}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    {triggerRun.data.mode} · {triggerRun.data.crawlMode} ·{' '}
                    {(triggerRun.data.requestedCanonicalNames.length > 0
                      ? triggerRun.data.requestedCanonicalNames.join(', ')
                      : 'all active targets')}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: '6px' }}>
                    Requested {triggerRun.data.requestedCanonicalNames.length} · Processed {triggerRun.data.processedCanonicalNames.length}
                    {executionMode === 'async' ? ' · background worker will consume queued jobs' : ' · returned from direct execution'}
                  </div>
                </div>
              )}

              <Button variant="primary" type="submit" disabled={triggerRun.isPending}>
                {triggerRun.isPending ? 'Queueing...' : 'Queue run'}
              </Button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
