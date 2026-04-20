
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card, Badge, Button } from '../components/ui';
import type { ApiReadinessResponse } from '../../../../packages/contracts/src/http';

export function Ops() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['readyz'],
    queryFn: () => fetchApi<ApiReadinessResponse>('/v1/ops/readyz'),
  });

  return (
    <div>
      <div style={{ marginBottom: '40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Operations</h1>
          <p style={{ color: 'var(--text-tertiary)' }}>System readiness and observability</p>
        </div>
        <Button onClick={() => refetch()}>Refresh Status</Button>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading system status...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading ops data</div>}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '24px' }}>
          <Card>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              Overall Status
              <Badge variant={data.status === 'ready' ? 'success' : 'neutral'}>
                {data.status.toUpperCase()}
              </Badge>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Active Sessions</div>
                <div style={{ fontSize: '24px', fontWeight: 510 }}>{data.activeSessions}</div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Active Targets</div>
                <div style={{ fontSize: '24px', fontWeight: 510 }}>{data.activeTargets}</div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Live Backlog</span>
                <span style={{ fontWeight: 510 }}>{data.queue.byMode.live.backlog}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Backfill Backlog</span>
                <span style={{ fontWeight: 510 }}>{data.queue.byMode.backfill.backlog}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Default Backlog</span>
                <span style={{ fontWeight: 510 }}>{data.queue.byMode.default.backlog}</span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
