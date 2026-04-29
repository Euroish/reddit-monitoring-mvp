import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Button, Card, Input, Select } from './ui';
import type { TriggerPhase1RunRequest, TriggerPhase1RunResponse } from '../../../../packages/contracts/src/http';

export function Phase1RunCard({
  title = 'Queue Phase 1 Run',
  subtitle = 'Use mock by default. Switch to live only when you need a real collection pass.',
  onRunSuccess,
}: {
  title?: string;
  subtitle?: string;
  onRunSuccess?: () => void;
}) {
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

  const triggerRun = useMutation({
    mutationFn: (payload: TriggerPhase1RunRequest) =>
      fetchApi<TriggerPhase1RunResponse>('/v1/runs/reddit-phase1', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      onRunSuccess?.();
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
    <Card>
      <h3 style={{ marginBottom: '8px' }}>{title}</h3>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginBottom: '16px' }}>
        {subtitle}
      </p>

      <form onSubmit={handleTriggerRun} className="list-stack" style={{ gap: '16px' }}>
        <div>
          <label htmlFor="phase1-subreddit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
            Subreddit
          </label>
          <Input
            id="phase1-subreddit"
            value={subreddit}
            onChange={(event) => setSubreddit(event.target.value)}
            placeholder="Optional, e.g. datascience"
          />
        </div>

        <div className="metric-grid">
          <div>
            <label htmlFor="phase1-mode" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Run mode
            </label>
            <Select
              id="phase1-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as 'mock' | 'live')}
            >
              <option value="mock">mock</option>
              <option value="live">live</option>
            </Select>
          </div>

          <div>
            <label htmlFor="phase1-crawl-mode" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Crawl mode
            </label>
            <Select
              id="phase1-crawl-mode"
              value={crawlMode}
              onChange={(event) => setCrawlMode(event.target.value as 'live' | 'backfill')}
            >
              <option value="live">live</option>
              <option value="backfill">backfill</option>
            </Select>
          </div>

          <div>
            <label htmlFor="phase1-execution-mode" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Execution
            </label>
            <Select
              id="phase1-execution-mode"
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
            <label htmlFor="phase1-backfill-post-limit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Backfill post budget per iteration
            </label>
            <Input
              id="phase1-backfill-post-limit"
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
            <label htmlFor="phase1-live-post-limit" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              Live post limit
            </label>
            <Input
              id="phase1-live-post-limit"
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
              <label htmlFor="phase1-backfill-iterations" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Max cursor iterations
              </label>
              <Input
                id="phase1-backfill-iterations"
                type="number"
                min={1}
                max={120}
                value={backfillMaxIterations}
                onChange={(event) => setBackfillMaxIterations(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="phase1-backfill-days" style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Target days
              </label>
              <Input
                id="phase1-backfill-days"
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
  );
}
