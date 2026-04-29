import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input, Select } from '../components/ui';
import { useLanguage } from '../i18n/LanguageContext';
import type {
  CollectionRunNowResponse,
  GetCollectionSettingsResponse,
  ListSubredditTargetsResponse,
  SubredditTargetAdminView,
  UpdateCollectionSettingsRequest,
  UpdateCollectionSettingsResponse,
} from '../../../../packages/contracts/src/http';

interface CollectionSettingsDraft {
  defaultCadenceHours: string;
  postLimitBase: string;
  postLimitBoost: string;
  adaptiveLimitEnabled: boolean;
  backfillPostLimit: string;
  backfillTargetDays: string;
  backfillMaxIterationsPerTarget: string;
  providerPreference: 'default' | 'http' | 'scrapling';
}

type DraftState = {
  source: string;
  value: CollectionSettingsDraft;
};

function buildDraft(response: GetCollectionSettingsResponse): CollectionSettingsDraft {
  return {
    defaultCadenceHours: String(response.settings.defaultCadenceHours),
    postLimitBase: String(response.settings.postLimitBase),
    postLimitBoost: String(response.settings.postLimitBoost),
    adaptiveLimitEnabled: response.settings.adaptiveLimitEnabled,
    backfillPostLimit: String(response.settings.backfillPostLimit),
    backfillTargetDays: String(response.settings.backfillTargetDays),
    backfillMaxIterationsPerTarget: String(response.settings.backfillMaxIterationsPerTarget),
    providerPreference: response.settings.providerPreference,
  };
}

function parsePositiveInt(value: string): number | undefined {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function targetCadenceHours(target: SubredditTargetAdminView, fallbackHours: number): number {
  return target.cadenceHours ?? fallbackHours;
}

export function OpsCollection() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ops.collection.settings'],
    queryFn: () => fetchApi<GetCollectionSettingsResponse>('/v1/ops/collection/settings'),
  });
  const { data: targetsData } = useQuery({
    queryKey: ['ops.targets'],
    queryFn: () => fetchApi<ListSubredditTargetsResponse>('/v1/targets/subreddit'),
  });
  const [subreddit, setSubreddit] = useState('');
  const [crawlMode, setCrawlMode] = useState<'live' | 'backfill'>('live');
  const [runAsync, setRunAsync] = useState(true);
  const dataSource = data?.requestId ?? '';
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const draft = draftState?.source === dataSource
    ? draftState.value
    : data
      ? buildDraft(data)
      : null;

  const updateDraft = (patch: Partial<CollectionSettingsDraft>) => {
    if (!draft) return;
    setDraftState({ source: dataSource, value: { ...draft, ...patch } });
  };

  const saveSettings = useMutation({
    mutationFn: (payload: UpdateCollectionSettingsRequest) =>
      fetchApi<UpdateCollectionSettingsResponse>('/v1/ops/collection/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (response) => {
      setDraftState({
        source: dataSource,
        value: buildDraft({ ok: true, requestId: response.requestId, settings: response.settings }),
      });
      void queryClient.invalidateQueries({ queryKey: ['ops.collection.settings'] });
      void queryClient.invalidateQueries({ queryKey: ['ops.targets'] });
      void refetch();
    },
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

  const targets = useMemo(() => targetsData?.targets ?? [], [targetsData?.targets]);
  const activeTargets = useMemo(
    () => targets.filter((target) => target.status === 'active'),
    [targets],
  );
  const autoCollectTargets = useMemo(
    () => activeTargets.filter((target) => target.favorite),
    [activeTargets],
  );
  const effectiveTargets = autoCollectTargets.length > 0 ? autoCollectTargets : activeTargets;
  const effectiveMode = autoCollectTargets.length > 0 ? 'favorites_only' : 'all_active_fallback';

  const saveAllSettings = () => {
    if (!draft) return;
    saveSettings.mutate({
      defaultCadenceHours: parsePositiveInt(draft.defaultCadenceHours),
      postLimitBase: parsePositiveInt(draft.postLimitBase),
      postLimitBoost: parsePositiveInt(draft.postLimitBoost),
      adaptiveLimitEnabled: draft.adaptiveLimitEnabled,
      backfillPostLimit: parsePositiveInt(draft.backfillPostLimit),
      backfillTargetDays: parsePositiveInt(draft.backfillTargetDays),
      backfillMaxIterationsPerTarget: parsePositiveInt(draft.backfillMaxIterationsPerTarget),
      providerPreference: draft.providerPreference,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('Collection')}</h1>
          <p className="page-subtitle">{t('Control automatic collection scope, cadence, and fetch budget from one place, then trigger live or backfill runs with the same backend settings.')}</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>{t('Loading collection settings...')}</div>}
      {error && <div style={{ color: '#ff4d4f' }}>{t('Error loading collection settings.')}</div>}

      {data && draft && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <Card>
            <h3 style={{ marginBottom: '16px' }}>{t('Automatic Collection Summary')}</h3>
            <div className="list-stack">
              <div className="metric-grid">
                <div>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>{t('Selection mode')}</div>
                  <div style={{ fontWeight: 560 }}>
                    {effectiveMode === 'favorites_only' ? t('Auto collect only marked targets') : t('Fallback to all active targets')}
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>{t('Auto targets now')}</div>
                  <div style={{ fontWeight: 560 }}>{effectiveTargets.length}</div>
                </div>
                <div>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>{t('Live fetch budget')}</div>
                  <div style={{ fontWeight: 560 }}>
                    {draft.adaptiveLimitEnabled
                      ? `${draft.postLimitBase} ${t('base, up to')} ${draft.postLimitBoost}`
                      : `${draft.postLimitBase} ${t('fixed new posts')}`}
                  </div>
                </div>
                <div>
                  <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-tertiary)' }}>{t('Backfill budget')}</div>
                  <div style={{ fontWeight: 560 }}>
                    {draft.backfillPostLimit} {t('per iteration for')} {draft.backfillTargetDays} {t('days')}
                  </div>
                </div>
              </div>

              <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                {t('Rule: if any target is marked Auto collect in')} <code>/ops/targets</code>{t(', the scheduler runs only those active targets. If none are marked, it falls back to all active targets.')}
              </div>

              <div className="list-stack">
                {effectiveTargets.slice(0, 12).map((target) => (
                  <div key={target.id} className="list-row">
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 560 }}>{target.canonicalName}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px' }}>
                        {target.favorite ? t('explicit auto-collect target') : t('included by all-active fallback')}
                      </div>
                    </div>
                    <Badge variant="neutral">{targetCadenceHours(target, data.settings.defaultCadenceHours)}h {t('cadence')}</Badge>
                  </div>
                ))}
                {effectiveTargets.length === 0 && (
                  <div style={{ color: 'var(--text-tertiary)' }}>{t('No active targets are currently eligible for automatic collection.')}</div>
                )}
                {effectiveTargets.length > 12 && (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                    {t('Showing 12 of')} {effectiveTargets.length} {t('automatic targets. Use')} <code>/ops/targets</code> {t('to edit the full pool.')}
                  </div>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <h3 style={{ marginBottom: '16px' }}>{t('Settings')}</h3>
            <div className="list-stack">
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Default auto-collect cadence hours')}</div>
                <Input
                  value={draft.defaultCadenceHours}
                  onChange={(event) => updateDraft({ defaultCadenceHours: event.target.value })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Live new-post budget')}</div>
                <Input
                  value={draft.postLimitBase}
                  onChange={(event) => updateDraft({ postLimitBase: event.target.value })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Adaptive live boost ceiling')}</div>
                <Input
                  value={draft.postLimitBoost}
                  onChange={(event) => updateDraft({ postLimitBoost: event.target.value })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Backfill post limit')}</div>
                <Input
                  value={draft.backfillPostLimit}
                  onChange={(event) => updateDraft({ backfillPostLimit: event.target.value })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Backfill target days')}</div>
                <Input
                  value={draft.backfillTargetDays}
                  onChange={(event) => updateDraft({ backfillTargetDays: event.target.value })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Backfill max iterations per target')}</div>
                <Input
                  value={draft.backfillMaxIterationsPerTarget}
                  onChange={(event) => updateDraft({ backfillMaxIterationsPerTarget: event.target.value })}
                />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Provider preference')}</div>
                <Select
                  value={draft.providerPreference}
                  onChange={(event) => updateDraft({ providerPreference: event.target.value as 'default' | 'http' | 'scrapling' })}
                >
                  <option value="default">default</option>
                  <option value="http">http</option>
                  <option value="scrapling">scrapling</option>
                </Select>
              </label>
              <label className="list-row-start">
                <input
                  type="checkbox"
                  checked={draft.adaptiveLimitEnabled}
                  onChange={(event) => updateDraft({ adaptiveLimitEnabled: event.target.checked })}
                />
                <span>{t('Adaptive live budget enabled')}</span>
              </label>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                {t('When adaptive budget is off, the scheduler uses the live new-post budget as a fixed per-run fetch count. When it is on, the scheduler starts from that base and can raise it up to the boost ceiling for hotter targets.')}
              </div>
              <div className="filter-bar">
                <Button type="button" variant="primary" onClick={saveAllSettings} disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? t('Saving...') : t('Save collection settings')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraftState({ source: dataSource, value: buildDraft(data) })} disabled={saveSettings.isPending}>
                  {t('Reset')}
                </Button>
              </div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                {t('Last updated')} {new Date(data.settings.updatedAt).toLocaleString()}
              </div>
            </div>
          </Card>

          <Card>
            <h3 style={{ marginBottom: '16px' }}>{t('Run Now')}</h3>
            <div className="list-stack">
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Subreddit')}</div>
                <Input value={subreddit} onChange={(event) => setSubreddit(event.target.value)} placeholder={t('Optional, e.g. datascience')} />
              </label>
              <label>
                <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>{t('Crawl mode')}</div>
                <Select value={crawlMode} onChange={(event) => setCrawlMode(event.target.value as 'live' | 'backfill')}>
                  <option value="live">live</option>
                  <option value="backfill">backfill</option>
                </Select>
              </label>
              <label className="list-row-start">
                <input type="checkbox" checked={runAsync} onChange={(event) => setRunAsync(event.target.checked)} />
                <span>{t('Queue async run')}</span>
              </label>
              <Button type="button" variant="primary" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? t('Running...') : t('Run now')}
              </Button>
              {runNow.data && (
                <div className="list-stack">
                  <Badge variant="success">{runNow.data.crawlMode}</Badge>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {t('Requested:')} {runNow.data.requestedCanonicalNames.join(', ') || t('all active targets')}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {t('Processed:')} {runNow.data.processedCanonicalNames.join(', ') || t('queued')}
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
