import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input } from '../components/ui';
import type {
  MaintenancePreviewResponse,
  MaintenancePruneResponse,
} from '../../../../packages/contracts/src/http';

type ActionKey = 'raw-events' | 'metrics-snapshots' | 'post-engagement-windows';

function describeAction(action: ActionKey): string {
  if (action === 'raw-events') {
    return 'Delete old fetch-event evidence rows. This is the lowest-risk cleanup and does not remove canonical content or materialized facts.';
  }
  if (action === 'metrics-snapshots') {
    return 'Delete old target-level metric snapshots such as subscribers, active users, and 15-minute post counters.';
  }
  return 'Delete old bounded post-engagement window history while keeping latest engagement state intact.';
}

export function OpsMaintenance() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ops.maintenance.preview'],
    queryFn: () => fetchApi<MaintenancePreviewResponse>('/v1/ops/maintenance/preview'),
  });
  const [retentionOverrides, setRetentionOverrides] = useState<Record<string, string>>({});
  const [batchSizeOverrides, setBatchSizeOverrides] = useState<Record<string, string>>({});
  const [loopUntilDoneOverrides, setLoopUntilDoneOverrides] = useState<Record<string, boolean>>({});
  const prune = useMutation({
    mutationFn: ({ action, dryRun }: { action: ActionKey; dryRun: boolean }) =>
      fetchApi<MaintenancePruneResponse>(`/v1/ops/maintenance/prune/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          retentionDays: Number(retentionOverrides[action] || data?.items.find((item) => item.action === action)?.retentionDays || 7),
          batchSize: Number(batchSizeOverrides[action] || 10000),
          dryRun,
          loopUntilDone: dryRun ? false : (loopUntilDoneOverrides[action] ?? true),
        }),
      }),
    onSuccess: () => refetch(),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Maintenance</h1>
          <p className="page-subtitle">Preview and execute the bounded retention prune actions the backend already supports.</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading maintenance preview...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading maintenance preview.</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {data.items.map((item) => (
            <Card key={item.action}>
              <div className="page-header" style={{ marginBottom: '16px' }}>
                <div>
                  <h3>{item.action}</h3>
                  <p className="page-subtitle">Estimated rows: {item.estimatedRows.toLocaleString()}</p>
                </div>
                <Badge variant="neutral">{item.retentionDays}d default</Badge>
              </div>

              <div className="list-stack">
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                  {describeAction(item.action)}
                </div>

                <label>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Retention days</div>
                  <Input
                    value={retentionOverrides[item.action] ?? String(item.retentionDays)}
                    onChange={(event) => setRetentionOverrides((current) => ({ ...current, [item.action]: event.target.value }))}
                  />
                </label>

                <label>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Batch size</div>
                  <Input
                    value={batchSizeOverrides[item.action] ?? '10000'}
                    onChange={(event) => setBatchSizeOverrides((current) => ({ ...current, [item.action]: event.target.value }))}
                  />
                </label>

                <label className="list-row-start">
                  <input
                    type="checkbox"
                    checked={loopUntilDoneOverrides[item.action] ?? true}
                    onChange={(event) => setLoopUntilDoneOverrides((current) => ({ ...current, [item.action]: event.target.checked }))}
                  />
                  <span>Loop until the selected retention bucket is fully pruned</span>
                </label>

                <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                  Dry run always previews one request only. Execute prune respects the loop setting so you can choose between one bounded pass and full drain of the current old-data bucket.
                </div>

                <div className="filter-bar">
                  <Button type="button" variant="ghost" onClick={() => prune.mutate({ action: item.action, dryRun: true })} disabled={prune.isPending}>
                    Dry run
                  </Button>
                  <Button type="button" variant="primary" onClick={() => prune.mutate({ action: item.action, dryRun: false })} disabled={prune.isPending}>
                    Execute prune
                  </Button>
                </div>

                {prune.data?.action === item.action && (
                  <div className="list-stack">
                    {prune.data.dryRun && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        Estimated rows: {prune.data.estimatedRows?.toLocaleString() ?? 0}
                      </div>
                    )}
                    {!prune.data.dryRun && (
                      <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                        Deleted rows: {prune.data.deletedRows?.toLocaleString() ?? 0}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
