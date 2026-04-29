import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchApi } from '../api/client';
import { Card, Badge, Button } from '../components/ui';
import { Phase1RunCard } from '../components/Phase1RunCard';
import type {
  ApiReadinessResponse,
  ApiStorageObservabilityResponse,
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

          <Phase1RunCard onRunSuccess={() => { void refetch(); }} />
        </div>
      )}
    </div>
  );
}
