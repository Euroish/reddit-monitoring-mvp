import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input, Select } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
import type {
  BulkUpdateSubredditTargetsResponse,
  ListSubredditTargetsResponse,
  SubredditTargetAdminView,
  UpdateSubredditTargetRequest,
  UpdateSubredditTargetResponse,
} from '../../../../packages/contracts/src/http';

type DraftValue = { status: 'active' | 'paused'; favorite: boolean; cadenceHours: string; notes: string; category: string };
type DraftState = Record<string, DraftValue & { baseRevision: number; baseSnapshot: string }>;

function draftSnapshot(draft: DraftValue) {
  const { status, favorite, cadenceHours, notes, category } = draft;
  return JSON.stringify({ status, favorite, cadenceHours, notes, category });
}

function makeDraft(target: SubredditTargetAdminView) {
  const value: DraftValue = {
    status: target.status,
    favorite: target.favorite,
    cadenceHours: target.cadenceHours == null ? '' : String(target.cadenceHours),
    notes: target.notes ?? '',
    category: target.category ?? '',
  };
  return { ...value, baseRevision: target.revision ?? 0, baseSnapshot: draftSnapshot(value) };
}

export function OpsTargets() {
  const { t, language } = useLanguage();
  const copy = (en: string, zh: string) => language === 'zh-CN' ? zh : en;
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<'active' | 'paused'>('paused');
  const [bulkCadenceHours, setBulkCadenceHours] = useState('');
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['ops.targets'],
    queryFn: () => fetchApi<ListSubredditTargetsResponse>('/v1/targets/subreddit'),
  });
  const [drafts, setDrafts] = useState<DraftState>({});
  const [notice, setNotice] = useState('');
  const dirtyNames = Object.keys(drafts).filter(name => draftSnapshot(drafts[name]) !== drafts[name].baseSnapshot);
  const hasUnsaved = dirtyNames.length > 0;
  useEffect(() => {
    if (!hasUnsaved) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const beforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const link = event.target.closest('a');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const destination = new URL(link.href, location.href);
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      const message = language === 'zh-CN' ? '离开后将丢弃未保存的目标修改，是否继续？' : 'Leaving will discard unsaved target changes. Continue?';
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLink, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeLink, true); };
  }, [hasUnsaved, language]);

  const targets = useMemo(() => data?.targets ?? [], [data?.targets]);
  const effectiveDrafts = useMemo(() => {
    const next: DraftState = {};
    for (const target of targets) {
      next[target.canonicalName] = drafts[target.canonicalName] ?? makeDraft(target);
    }
    return next;
  }, [drafts, targets]);

  const saveTarget = useMutation({
    mutationFn: ({ canonicalName, patch }: { canonicalName: string; patch: UpdateSubredditTargetRequest }) =>
      fetchApi<UpdateSubredditTargetResponse>(`/v1/targets/subreddit/${canonicalName.replace(/^r\//i, '')}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (_response, variables) => {
      setDrafts(current => { const next = { ...current }; delete next[variables.canonicalName]; return next; });
      setNotice(copy('Target saved.', '目标已保存。'));
      return queryClient.invalidateQueries({ queryKey: ['ops.targets'] });
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ['ops.targets'] }); },
  });

  const bulkUpdate = useMutation({
    mutationFn: (payload: { canonicalNames: string[]; patch: UpdateSubredditTargetRequest }) =>
      fetchApi<BulkUpdateSubredditTargetsResponse>('/v1/targets/subreddit/bulk-update', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => { setNotice(copy('Bulk update saved.', '批量修改已保存。')); return queryClient.invalidateQueries({ queryKey: ['ops.targets'] }); },
  });

  const toggleSelected = (canonicalName: string) => {
    setSelected((current) =>
      current.includes(canonicalName)
        ? current.filter((item) => item !== canonicalName)
        : [...current, canonicalName],
    );
  };

  const saveRow = (canonicalName: string) => {
    const draft = effectiveDrafts[canonicalName];
    saveTarget.mutate({
      canonicalName,
      patch: {
        status: draft.status,
        favorite: draft.favorite,
        cadenceHours: draft.cadenceHours.trim() === '' ? null : Number(draft.cadenceHours),
        notes: draft.notes.trim() || null,
        category: draft.category.trim() || null,
        expectedRevision: draft.baseRevision,
      },
    });
  };

  const applyBulk = () => {
    if (selected.length === 0) return;
    bulkUpdate.mutate({
      canonicalNames: selected,
      patch: {
        status: bulkStatus,
        cadenceHours: bulkCadenceHours.trim() === '' ? undefined : Number(bulkCadenceHours),
      },
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('Targets')}</h1>
          <p className="page-subtitle">{t('Manage monitored subreddits, decide which ones participate in automatic live collection, and edit per-target cadence overrides.')}</p>
        </div>
        <Button type="button" disabled={isFetching} onClick={() => void refetch()}>{copy('Refresh targets', '刷新目标')}</Button>
      </div>
      {hasUnsaved && <p role="status">{copy(`${dirtyNames.length} target drafts are unsaved. Refresh keeps them; leaving discards them.`, `${dirtyNames.length} 个目标草稿尚未保存。刷新会保留草稿，离开页面会丢弃。`)} <Button type="button" onClick={() => setDrafts({})}>{copy('Discard all drafts', '丢弃全部草稿')}</Button></p>}
      {notice && <p role="status">{notice}</p>}
      {(saveTarget.error || bulkUpdate.error) && <p role="alert" style={{ color: '#ff4d4f' }}>{(saveTarget.error ?? bulkUpdate.error)?.message}</p>}

      <Card style={{ marginBottom: '24px' }}>
        <div className="filter-bar">
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{selected.length} {t('selected')}</span>
          <Select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as 'active' | 'paused')} style={{ maxWidth: '160px' }}>
            <option value="paused">paused</option>
            <option value="active">active</option>
          </Select>
          <Input value={bulkCadenceHours} onChange={(event) => setBulkCadenceHours(event.target.value)} placeholder={t('cadence hours')} style={{ maxWidth: '160px' }} />
          <Button type="button" variant="primary" onClick={applyBulk} disabled={selected.length === 0 || bulkUpdate.isPending || saveTarget.isPending || selected.some(name => dirtyNames.includes(name))}>
            {bulkUpdate.isPending ? t('Applying...') : t('Apply bulk update')}
          </Button>
        </div>
        <p className="page-subtitle">{copy('Bulk updates have no per-row revision check. Save or discard selected row drafts first.', '批量更新不检查每行版本，请先保存或丢弃所选行的草稿。')}</p>
      </Card>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>{t('Loading targets...')}</div>}
      {error && <div style={{ color: '#ff4d4f' }}>{t('Error loading targets.')}</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: '1fr' }}>
          {data.targets.map((target) => {
            const draft = effectiveDrafts[target.canonicalName];
            const dirty = dirtyNames.includes(target.canonicalName);
            const conflict = dirty && draft.baseRevision !== (target.revision ?? 0);
            const busy = saveTarget.isPending || bulkUpdate.isPending;
            return (
              <Card key={target.id}>
                {conflict && <p role="alert">{copy('This target changed while editing. Your draft is retained; discard it to load the current version before retrying.', '编辑期间此目标已变更，草稿已保留。请丢弃草稿以载入当前版本，再重试。')}</p>}
                <div className="filter-bar" style={{ justifyContent: 'space-between', marginBottom: '16px' }}>
                  <label className="list-row-start" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(target.canonicalName)}
                      onChange={() => toggleSelected(target.canonicalName)}
                    />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 560 }}>{target.canonicalName}</span>
                  </label>
                  <div className="list-row-end">
                    <Badge variant={target.status === 'active' ? 'success' : 'neutral'}>{t(target.status)}</Badge>
                    {target.favorite && <Badge variant="neutral">{t('auto collect')}</Badge>}
                  </div>
                </div>

                <div className="metric-grid" style={{ marginBottom: '16px' }}>
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginBottom: '6px' }}>{t('Last collected')}</div>
                    <div>{target.lastCollectedAt ? new Date(target.lastCollectedAt).toLocaleString() : 'n/a'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginBottom: '6px' }}>{t('Last trend')}</div>
                    <div>{target.lastTrendAt ? new Date(target.lastTrendAt).toLocaleString() : 'n/a'}</div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginBottom: '6px' }}>{t('Recent post volume')}</div>
                    <div>{target.recentPostVolume ?? 'n/a'}</div>
                  </div>
                </div>

                <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Status')}</label>
                    <Select
                      aria-label={`${copy('Status', '状态')} ${target.canonicalName}`} disabled={busy}
                      value={draft.status}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, status: event.target.value as 'active' | 'paused' } }))}
                    >
                      <option value="active">active</option>
                      <option value="paused">paused</option>
                    </Select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Cadence hours')}</label>
                    <Input
                      aria-label={`${copy('Cadence hours', '间隔小时')} ${target.canonicalName}`} disabled={busy} type="number" min={1} max={168}
                      value={draft.cadenceHours}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, cadenceHours: event.target.value } }))}
                    />
                  </div>

                  <label className="list-row-start" style={{ minHeight: '44px' }}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={draft.favorite}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, favorite: event.target.checked } }))}
                    />
                    <span>{t('Auto collect')}</span>
                  </label>

                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Category')}</label>
                    <Input
                      aria-label={`${copy('Category', '分类')} ${target.canonicalName}`} disabled={busy}
                      value={draft.category}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, category: event.target.value } }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Notes')}</label>
                    <Input
                      aria-label={`${copy('Notes', '备注')} ${target.canonicalName}`} disabled={busy}
                      value={draft.notes}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, notes: event.target.value } }))}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <Button type="button" variant="primary" onClick={() => saveRow(target.canonicalName)} disabled={!dirty || busy || conflict}>
                    {saveTarget.isPending ? t('Saving...') : t('Save target')}
                  </Button>
                  <Button type="button" style={{ marginLeft: 8 }} disabled={!dirty || busy} onClick={() => { setDrafts(current => { const next = { ...current }; delete next[target.canonicalName]; return next; }); saveTarget.reset(); }}>{copy('Cancel edits', '取消编辑')}</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
