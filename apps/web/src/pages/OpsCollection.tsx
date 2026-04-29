import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input, Select } from '../components/ui';
import type {
  CollectionRunNowResponse,
  GetCollectionSettingsResponse,
  UpdateCollectionSettingsRequest,
  UpdateCollectionSettingsResponse,
} from '../../../../packages/contracts/src/http';

export function OpsCollection() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ops.collection.settings'],
    queryFn: () => fetchApi<GetCollectionSettingsResponse>('/v1/ops/collection/settings'),
  });
  const [subreddit, setSubreddit] = useState('');
  const [crawlMode, setCrawlMode] = useState<'live' | 'backfill'>('live');
  const [runAsync, setRunAsync] = useState(true);

  const saveSettings = useMutation({
    mutationFn: (payload: UpdateCollectionSettingsRequest) =>
      fetchApi<UpdateCollectionSettingsResponse>('/v1/ops/collection/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => refetch(),
  });

  const runNow = useMutation({
    mutationFn: () =>
      fetchApi<CollectionRunNowResponse>('/v1/ops/collection/run-now', {
        method: 'POST',
        body: JSON.stringify({
          subreddit: subreddit.trim() || undefined,
          crawlMode,
          async: runAsync,
        }),
      }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Collection</h1>
          <p className="page-subtitle">Edit stored collection defaults and trigger a live or backfill run with the same settings backend.</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading collection settings...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading collection settings.</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <Card>
            <h3 style={{ marginBottom: '16px' }}>Settings</h3>
            <div className="list-stack">
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Default cadence hours</div>
                <Input
                  defaultValue={data.settings.defaultCadenceHours}
                  onBlur={(event) => saveSettings.mutate({ defaultCadenceHours: Number(event.target.value) })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Post limit base</div>
                <Input
                  defaultValue={data.settings.postLimitBase}
                  onBlur={(event) => saveSettings.mutate({ postLimitBase: Number(event.target.value) })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Post limit boost</div>
                <Input
                  defaultValue={data.settings.postLimitBoost}
                  onBlur={(event) => saveSettings.mutate({ postLimitBoost: Number(event.target.value) })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Backfill post limit</div>
                <Input
                  defaultValue={data.settings.backfillPostLimit}
                  onBlur={(event) => saveSettings.mutate({ backfillPostLimit: Number(event.target.value) })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Backfill target days</div>
                <Input
                  defaultValue={data.settings.backfillTargetDays}
                  onBlur={(event) => saveSettings.mutate({ backfillTargetDays: Number(event.target.value) })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Backfill max iterations per target</div>
                <Input
                  defaultValue={data.settings.backfillMaxIterationsPerTarget}
                  onBlur={(event) => saveSettings.mutate({ backfillMaxIterationsPerTarget: Number(event.target.value) })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Provider preference</div>
                <Select
                  defaultValue={data.settings.providerPreference}
                  onChange={(event) => saveSettings.mutate({ providerPreference: event.target.value as 'default' | 'http' | 'scrapling' })}
                >
                  <option value="default">default</option>
                  <option value="http">http</option>
                  <option value="scrapling">scrapling</option>
                </Select>
              </label>
              <label className="list-row-start">
                <input
                  type="checkbox"
                  defaultChecked={data.settings.adaptiveLimitEnabled}
                  onChange={(event) => saveSettings.mutate({ adaptiveLimitEnabled: event.target.checked })}
                />
                <span>Adaptive limit enabled</span>
              </label>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                Last updated {new Date(data.settings.updatedAt).toLocaleString()}
              </div>
            </div>
          </Card>

          <Card>
            <h3 style={{ marginBottom: '16px' }}>Run Now</h3>
            <div className="list-stack">
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Subreddit</div>
                <Input value={subreddit} onChange={(event) => setSubreddit(event.target.value)} placeholder="Optional, e.g. datascience" />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Crawl mode</div>
                <Select value={crawlMode} onChange={(event) => setCrawlMode(event.target.value as 'live' | 'backfill')}>
                  <option value="live">live</option>
                  <option value="backfill">backfill</option>
                </Select>
              </label>
              <label className="list-row-start">
                <input type="checkbox" checked={runAsync} onChange={(event) => setRunAsync(event.target.checked)} />
                <span>Queue async run</span>
              </label>
              <Button type="button" variant="primary" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? 'Running...' : 'Run now'}
              </Button>
              {runNow.data && (
                <div className="list-stack">
                  <Badge variant="success">{runNow.data.crawlMode}</Badge>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Requested: {runNow.data.requestedCanonicalNames.join(', ') || 'all active targets'}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    Processed: {runNow.data.processedCanonicalNames.join(', ') || 'queued'}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
