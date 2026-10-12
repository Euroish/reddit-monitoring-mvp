import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
import type { ListAppAuditResponse } from '../../../../packages/contracts/src/http';

export function OpsAudit() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const copy = (en: string, zh: string) => language === 'zh-CN' ? zh : en;
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const canRead = user?.role === 'owner' || user?.role === 'admin';
  const audit = useQuery({ queryKey: ['ops.audit', user?.id, cursor], enabled: canRead, retry: false,
    queryFn: ({ signal }) => fetchApi<ListAppAuditResponse>(`/v1/ops/audit?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }) });
  return <div>
    <div className="page-header"><div><h1>{copy('Operation audit', '操作审计')}</h1>
      <p className="page-subtitle">{copy('Review who changed users, sources, tasks and budgets. Each page contains at most 50 records.', '追溯用户、来源、任务与预算操作，每页最多 50 条记录。')}</p></div>
      <Button type="button" disabled={audit.isFetching} onClick={() => void audit.refetch()}>{copy('Refresh', '刷新')}</Button></div>
    {audit.isLoading && <p role="status">{copy('Loading audit...', '正在加载审计...')}</p>}
    {audit.error && <p role="alert" style={{ color: '#ff4d4f' }}>{audit.error.message}</p>}
    <div className="list-stack" style={{ gap: 16 }}>
      {audit.data?.entries.map(entry => <Card key={entry.id}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}><h3>{entry.action}</h3>
          <Badge variant={entry.outcome === 'succeeded' ? 'success' : 'neutral'}>{copy(entry.outcome, { attempted: '已尝试', succeeded: '成功', failed: '失败' }[entry.outcome])}</Badge></div>
        <p style={{ color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}>{new Date(entry.createdAt).toLocaleString()} · {entry.actorType} · {entry.actorUserId ?? copy('Machine', '机器身份')}</p>
        <p style={{ overflowWrap: 'anywhere' }}>{entry.resourceType}: {entry.resourceId ?? '—'} · {copy('Request', '请求')}: {entry.requestId ?? '—'}</p>
        <details><summary>{copy('Recorded changes', '变更记录')}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(entry.changes, null, 2)}</pre></details>
      </Card>)}
      {audit.data?.entries.length === 0 && <Card>{copy('No audit records in this page.', '此页没有审计记录。')}</Card>}
    </div>
    <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
      <Button type="button" disabled={!cursors.length || audit.isFetching} onClick={() => setCursors(value => value.slice(0, -1))}>{copy('Previous page', '上一页')}</Button>
      <Button type="button" disabled={!audit.data?.nextCursor || audit.isFetching} onClick={() => { if (audit.data?.nextCursor) setCursors(value => [...value, audit.data!.nextCursor!]); }}>{copy('Next page', '下一页')}</Button>
    </div>
  </div>;
}
