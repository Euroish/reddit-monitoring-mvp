import { useMemo, useState } from 'react';
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

type DraftState = Record<string, { status: 'active' | 'paused'; favorite: boolean; cadenceHours: string; notes: string; category: string }>;

function makeDraft(target: SubredditTargetAdminView) {
  return {
    status: target.status,
    favorite: target.favorite,
    cadenceHours: target.cadenceHours == null ? '' : String(target.cadenceHours),
    notes: target.notes ?? '',
    category: target.category ?? '',
  };
}

export function OpsTargets() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<'active' | 'paused'>('paused');
  const [bulkCadenceHours, setBulkCadenceHours] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['ops.targets'],
    queryFn: () => fetchApi<ListSubredditTargetsResponse>('/v1/targets/subreddit'),
  });
  const [drafts, setDrafts] = useState<DraftState>({});

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ops.targets'] }),
  });

  const bulkUpdate = useMutation({
    mutationFn: (payload: { canonicalNames: string[]; patch: UpdateSubredditTargetRequest }) =>
      fetchApi<BulkUpdateSubredditTargetsResponse>('/v1/targets/subreddit/bulk-update', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ops.targets'] }),
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
      </div>

      <Card style={{ marginBottom: '24px' }}>
        <div className="filter-bar">
          <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{selected.length} {t('selected')}</span>
          <Select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as 'active' | 'paused')} style={{ maxWidth: '160px' }}>
            <option value="paused">paused</option>
            <option value="active">active</option>
          </Select>
          <Input value={bulkCadenceHours} onChange={(event) => setBulkCadenceHours(event.target.value)} placeholder={t('cadence hours')} style={{ maxWidth: '160px' }} />
          <Button type="button" variant="primary" onClick={applyBulk} disabled={selected.length === 0 || bulkUpdate.isPending}>
            {bulkUpdate.isPending ? t('Applying...') : t('Apply bulk update')}
          </Button>
        </div>
      </Card>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>{t('Loading targets...')}</div>}
      {error && <div style={{ color: '#ff4d4f' }}>{t('Error loading targets.')}</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: '1fr' }}>
          {data.targets.map((target) => {
            const draft = effectiveDrafts[target.canonicalName];
            return (
              <Card key={target.id}>
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
                      value={draft.cadenceHours}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, cadenceHours: event.target.value } }))}
                    />
                  </div>

                  <label className="list-row-start" style={{ minHeight: '44px' }}>
                    <input
                      type="checkbox"
                      checked={draft.favorite}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, favorite: event.target.checked } }))}
                    />
                    <span>{t('Auto collect')}</span>
                  </label>

                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Category')}</label>
                    <Input
                      value={draft.category}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, category: event.target.value } }))}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Notes')}</label>
                    <Input
                      value={draft.notes}
                      onChange={(event) => setDrafts((current) => ({ ...current, [target.canonicalName]: { ...draft, notes: event.target.value } }))}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                  <Button type="button" variant="primary" onClick={() => saveRow(target.canonicalName)} disabled={saveTarget.isPending}>
                    {saveTarget.isPending ? t('Saving...') : t('Save target')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
