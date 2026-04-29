import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Card, Input, Select } from '../components/ui';
import { WorkbenchChart } from '../features/workbench/components/WorkbenchChart';
import { buildComparisonChartOptions } from '../features/workbench/model/chartOptions';
import { normalizeWorkbenchRange, WORKBENCH_RANGE_PRESETS } from '../features/workbench/model/urlState';
import { useLanguage } from '../i18n/LanguageContext';
import type {
  CreateSavedWorkbenchViewRequest,
  CreateSavedWorkbenchViewResponse,
  MarketTrendResponse,
  TargetComparisonWorkbenchResponse,
} from '../../../../packages/contracts/src/http';

function parseTargets(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim().replace(/^r\//i, ''))
        .filter(Boolean),
    ),
  );
}

function buildComparePath(targets: string[], range: string) {
  const params = new URLSearchParams({
    targets: targets.join(','),
    series: 'heat_price,total_new_posts',
    range,
    timeframe: '1d',
  });
  return `/v1/workbench/compare?${params.toString()}`;
}

export function Compare() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const range = normalizeWorkbenchRange(searchParams.get('range'));
  const [input, setInput] = useState(searchParams.get('targets') ?? '');
  const [viewName, setViewName] = useState('');
  const targets = useMemo(() => parseTargets(searchParams.get('targets') ?? ''), [searchParams]);
  const targetCount = targets.length;
  const canQuery = targetCount >= 2 && targetCount <= 6;

  const { data: marketData } = useQuery({
    queryKey: ['market.overview.compare-picks'],
    queryFn: () => fetchApi<MarketTrendResponse>('/v1/trends/market?limit=12'),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['compare.view', range, targets.join(',')],
    queryFn: () => fetchApi<TargetComparisonWorkbenchResponse>(buildComparePath(targets, range)),
    enabled: canQuery,
  });

  const saveView = useMutation({
    mutationFn: (payload: CreateSavedWorkbenchViewRequest) =>
      fetchApi<CreateSavedWorkbenchViewResponse>('/v1/workbench/saved-views', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });

  const chartOptions = useMemo(() => buildComparisonChartOptions(data), [data]);

  const applyTargets = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const normalized = parseTargets(input).join(',');
    if (normalized) {
      next.set('targets', normalized);
    } else {
      next.delete('targets');
    }
    setSearchParams(next);
  };

  const addTarget = (canonicalName: string) => {
    const nextTargets = Array.from(new Set([...targets, canonicalName.replace(/^r\//i, '')])).slice(0, 6);
    const next = new URLSearchParams(searchParams);
    next.set('targets', nextTargets.join(','));
    setInput(nextTargets.join(','));
    setSearchParams(next);
  };

  const updateRange = (nextRange: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('range', nextRange);
    setSearchParams(next);
  };

  const saveCurrentView = () => {
    if (!canQuery) return;
    saveView.mutate({
      name: viewName.trim() || `${targets.join(' vs ')} compare`,
      viewKind: 'comparison',
      primaryTarget: `r/${targets[0]}`,
      compareTargets: targets.slice(1).map((target) => `r/${target}`),
      keywords: [],
      seriesIds: ['heat_price', 'total_new_posts'],
      routePath: `${window.location.pathname}${window.location.search}`,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('Compare')}</h1>
          <p className="page-subtitle">{t('Cross-target comparison with a hard frontend cap of 6 subreddits.')}</p>
        </div>
      </div>

      <Card style={{ marginBottom: '24px' }}>
        <form onSubmit={applyTargets} className="filter-bar">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="datascience, machinelearning, startups"
            style={{ minWidth: '320px', flex: 1 }}
          />
          <Select value={range} onChange={(event) => updateRange(event.target.value)} style={{ maxWidth: '160px' }}>
            {WORKBENCH_RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>{preset}</option>
            ))}
          </Select>
          <Button type="submit" variant="primary">{t('Apply')}</Button>
        </form>

        <div style={{ marginTop: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {targets.map((target) => (
            <Badge key={target} variant="neutral">{`r/${target}`}</Badge>
          ))}
          {targetCount > 6 && <div style={{ color: '#ff4d4f', fontSize: '13px' }}>{t('Maximum 6 targets.')}</div>}
          {targetCount > 0 && targetCount < 2 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{t('Choose at least 2 targets.')}</div>
          )}
        </div>

        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(marketData?.rankings.byHeat ?? []).slice(0, 6).map((item) => (
            <Button key={item.targetId} type="button" variant="ghost" onClick={() => addTarget(item.canonicalName)}>
              {item.canonicalName}
            </Button>
          ))}
        </div>
      </Card>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>{t('Loading comparison...')}</div>}
      {error && <div style={{ color: '#ff4d4f' }}>{t('Error loading comparison.')}</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <Card>
            <div style={{ marginBottom: '18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <h3>{t('Normalized Trend View')}</h3>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: '6px' }}>
                  {t('First non-zero point is normalized to 100.')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {data.targets.map((target) => (
                  <Badge key={target.targetId} variant="neutral">{target.canonicalName}</Badge>
                ))}
              </div>
            </div>
            <div className="chart-shell">
              <WorkbenchChart option={chartOptions} />
            </div>
          </Card>

          <Card>
            <div className="filter-bar" style={{ marginBottom: '16px' }}>
              <Input
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                placeholder={t('Save current comparison')}
                style={{ maxWidth: '320px' }}
              />
              <Button type="button" variant="primary" onClick={saveCurrentView} disabled={saveView.isPending}>
                {saveView.isPending ? t('Saving...') : t('Save view')}
              </Button>
              {saveView.isSuccess && <Badge variant="success">{t('Saved')}</Badge>}
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('Subreddit')}</th>
                    <th>{t('Heat')}</th>
                    <th>{t('Total / observed posts')}</th>
                    <th>{t('Qualified posts')}</th>
                    <th>{t('Open')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.summary.map((item) => (
                    <tr key={item.targetId}>
                      <td>{item.canonicalName}</td>
                      <td>{item.latestHeatPrice == null ? 'n/a' : item.latestHeatPrice.toFixed(0)}</td>
                      <td>{item.latestTotalNewPosts == null ? 'n/a' : item.latestTotalNewPosts.toLocaleString()}</td>
                      <td>{item.latestQualifiedPostCount == null ? 'n/a' : item.latestQualifiedPostCount.toLocaleString()}</td>
                      <td>
                        <Link to={`/target/${item.canonicalName.replace(/^r\//i, '')}`}>{t('Target')}</Link>
                      </td>
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
