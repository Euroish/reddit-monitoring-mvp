import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card, Badge, Button, Input, Select } from '../components/ui';
import type {
  ApiReadinessResponse,
  TriggerPhase1RunRequest,
  TriggerPhase1RunResponse,
} from '../../../../packages/contracts/src/http';

export function Ops() {
  const [subreddit, setSubreddit] = useState('');
  const [mode, setMode] = useState<'mock' | 'live'>('mock');
  const [crawlMode, setCrawlMode] = useState<'live' | 'backfill'>('live');
  const [postLimit, setPostLimit] = useState('20');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['readyz'],
    queryFn: () => fetchApi<ApiReadinessResponse>('/v1/ops/readyz'),
  });

  const triggerRun = useMutation({
    mutationFn: (payload: TriggerPhase1RunRequest) =>
      fetchApi<TriggerPhase1RunResponse>('/v1/runs/reddit-phase1', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });

  const handleTriggerRun = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedPostLimit = Number(postLimit);

    triggerRun.mutate({
      mode,
      crawlMode,
      subreddit: subreddit.trim() || undefined,
      postLimit:
        Number.isInteger(normalizedPostLimit) && normalizedPostLimit >= 1 && normalizedPostLimit <= 200
          ? normalizedPostLimit
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
        <Button onClick={() => refetch()} disabled={isLoading}>
          Refresh Status
        </Button>
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
              </div>

              <div>
                <label htmlFor="ops-post-limit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Post limit
                </label>
                <Input
                  id="ops-post-limit"
                  type="number"
                  min={1}
                  max={200}
                  value={postLimit}
                  onChange={(event) => setPostLimit(event.target.value)}
                />
              </div>

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
                  <div style={{ marginBottom: '6px', fontWeight: 510 }}>Run queued</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                    {triggerRun.data.mode} · {triggerRun.data.crawlMode} ·{' '}
                    {(triggerRun.data.requestedCanonicalNames.length > 0
                      ? triggerRun.data.requestedCanonicalNames.join(', ')
                      : 'all active targets')}
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
