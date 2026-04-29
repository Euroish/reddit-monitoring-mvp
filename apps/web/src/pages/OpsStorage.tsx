import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card } from '../components/ui';
import type { ApiStorageObservabilityResponse } from '../../../../packages/contracts/src/http';

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
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

export function OpsStorage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops.storage.page'],
    queryFn: () => fetchApi<ApiStorageObservabilityResponse>('/v1/ops/storage'),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Storage</h1>
          <p className="page-subtitle">Database footprint, table growth, and current storage pressure.</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading storage snapshot...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading storage snapshot.</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <Card>
            <div className="metric-grid">
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Database size</div>
                <div className="kpi-value">{formatBytes(data.databaseSizeBytes)}</div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Captured</div>
                <div style={{ fontWeight: 560 }}>{new Date(data.capturedAtIso).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Tracked tables</div>
                <div className="kpi-value">{data.tables.length}</div>
              </div>
            </div>
          </Card>

          <Card style={{ padding: '0', overflow: 'hidden' }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Rows</th>
                    <th>Table bytes</th>
                    <th>Index bytes</th>
                    <th>Total bytes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tables.map((table) => (
                    <tr key={table.tableName}>
                      <td>{table.tableName}</td>
                      <td>{table.rowEstimate.toLocaleString()}</td>
                      <td>{formatBytes(table.tableBytes)}</td>
                      <td>{formatBytes(table.indexBytes)}</td>
                      <td>{formatBytes(table.totalBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
