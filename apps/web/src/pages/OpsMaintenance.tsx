import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input } from '../components/ui';
import type {
  MaintenancePreviewResponse,
  MaintenancePruneResponse,
} from '../../../../packages/contracts/src/http';

type ActionKey = 'raw-events' | 'metrics-snapshots' | 'post-engagement-windows';

export function OpsMaintenance() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ops.maintenance.preview'],
    queryFn: () => fetchApi<MaintenancePreviewResponse>('/v1/ops/maintenance/preview'),
  });
  const [retentionOverrides, setRetentionOverrides] = useState<Record<string, string>>({});
  const prune = useMutation({
    mutationFn: ({ action, dryRun }: { action: ActionKey; dryRun: boolean }) =>
      fetchApi<MaintenancePruneResponse>(`/v1/ops/maintenance/prune/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          retentionDays: Number(retentionOverrides[action] || data?.items.find((item) => item.action === action)?.retentionDays || 7),
          batchSize: 10000,
          dryRun,
          loopUntilDone: !dryRun,
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
                <label>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>Retention days</div>
                  <Input
                    value={retentionOverrides[item.action] ?? String(item.retentionDays)}
                    onChange={(event) => setRetentionOverrides((current) => ({ ...current, [item.action]: event.target.value }))}
                  />
                </label>

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
