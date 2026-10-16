import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
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
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const copy = (en: string, cn: string) => zh ? cn : en;
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops.storage.page'],
    queryFn: () => fetchApi<ApiStorageObservabilityResponse>('/v1/ops/storage'),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{copy('Storage', '存储')}</h1>
          <p className="page-subtitle">{copy('Database footprint and the current public-table inventory.', '数据库占用与当前 public 表库存。')}</p>
        </div>
      </div>

      {isLoading && <div role="status" style={{ color: 'var(--text-tertiary)' }}>{copy('Loading storage snapshot...', '正在加载存储快照…')}</div>}
      {error && <div role="alert" style={{ color: '#ff4d4f' }}>{copy('Error loading storage snapshot.', '无法加载存储快照。')}</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <Card>
            <div className="metric-grid">
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{copy('Database size', '数据库大小')}</div>
                <div className="kpi-value">{formatBytes(data.databaseSizeBytes)}</div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{copy('Captured', '统计时刻')}</div>
                <div style={{ fontWeight: 560 }}>{new Date(data.capturedAtIso).toLocaleString()}</div>
              </div>
              <div>
                <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{copy('Public tables', 'Public 表数')}</div>
                <div className="kpi-value">{data.tables.length}</div>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.65, marginBottom: 0 }}>{copy('The inventory includes ordinary and partitioned user tables in public. Row counts are PostgreSQL statistics estimates and may be stale or zero before statistics are collected. Database size also includes storage outside this table list.', '库存包含 public 中的普通表与分区表。行数来自 PostgreSQL 统计估计，可能过时，尚未收集统计时也可能显示为 0；数据库大小还包含表清单之外的存储。')}</p>
          </Card>

          <Card style={{ padding: '0', overflow: 'hidden' }}>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{copy('Table', '表名')}</th>
                    <th>{copy('Estimated rows', '估计行数')}</th>
                    <th>{copy('Table bytes', '表占用')}</th>
                    <th>{copy('Index bytes', '索引占用')}</th>
                    <th>{copy('Total bytes', '总占用')}</th>
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
