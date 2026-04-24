import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card, Badge, Button, Input } from '../components/ui';
import { WorkbenchChart } from '../features/workbench/components/WorkbenchChart';
import {
  buildComparisonChartOptions,
  buildTargetWorkbenchChartOptions,
  createInitialSeriesSelection,
} from '../features/workbench/model/chartOptions';
import {
  buildComparisonPath,
  buildWorkbenchPath,
  normalizeWorkbenchRange,
  parseCompareTargets,
  parseCsvList,
  WORKBENCH_RANGE_PRESETS,
} from '../features/workbench/model/urlState';
import type {
  MarketTrendResponse,
  CreateSavedWorkbenchViewRequest,
  CreateSavedWorkbenchViewResponse,
  ListSavedWorkbenchViewsResponse,
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
} from '../../../../packages/contracts/src/http';

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

export function TargetDetail() {
  const { targetId } = useParams<{ targetId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const keywords = searchParams.get('keywords');
  const range = normalizeWorkbenchRange(searchParams.get('range'));
  const timeframe = '1d' as const;
  const [overlayInput, setOverlayInput] = useState(keywords ?? '');
  const compare = searchParams.get('compare');
  const [compareInput, setCompareInput] = useState(compare ?? '');
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set());
  const [hiddenOverlayIds, setHiddenOverlayIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['target-workbench', targetId, keywords, range, timeframe],
    queryFn: () =>
      fetchApi<TargetWorkbenchResponse>(buildWorkbenchPath({ targetId, keywords, range, timeframe })),
    enabled: !!targetId,
  });

  const { data: comparisonData } = useQuery({
    queryKey: ['target-comparison-workbench', targetId, compare, range, timeframe],
    queryFn: () =>
      fetchApi<TargetComparisonWorkbenchResponse>(
        buildComparisonPath({ targetId, compare, range, timeframe }),
      ),
    enabled: !!targetId && !!compare?.trim(),
  });

  const { data: marketData } = useQuery({
    queryKey: ['market-trend'],
    queryFn: () => fetchApi<MarketTrendResponse>('/v1/trends/market'),
  });

  const { data: savedViews } = useQuery({
    queryKey: ['saved-workbench-views'],
    queryFn: () => fetchApi<ListSavedWorkbenchViewsResponse>('/v1/workbench/saved-views?limit=6'),
  });

  const saveViewMutation = useMutation({
    mutationFn: (payload: CreateSavedWorkbenchViewRequest) =>
      fetchApi<CreateSavedWorkbenchViewResponse>('/v1/workbench/saved-views', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['saved-workbench-views'] });
    },
  });

  useEffect(() => {
    setOverlayInput(keywords ?? '');
    setHiddenOverlayIds(new Set());
  }, [keywords]);

  useEffect(() => {
    setCompareInput(compare ?? '');
  }, [compare]);

  useEffect(() => {
    if (data) {
      setActiveSeries(createInitialSeriesSelection(data));
    }
  }, [data?.target.targetId]);

  const latestDailyPoint = useMemo(() => {
    if (!data?.series.length) return null;
    const latestIndex = Math.max(0, data.series[0]?.points.length ?? 0) - 1;
    const valueFor = (seriesId: string) =>
      data.series.find((series) => series.id === seriesId)?.points[latestIndex]?.value ?? null;
    return {
      heatPrice: valueFor('heat_price'),
      posts: valueFor('total_new_posts'),
      qualifiedPosts: valueFor('qualified_post_count'),
    };
  }, [data]);

  const selectedCompareTargets = useMemo(() => parseCompareTargets(compare), [compare]);
  const suggestedCompareTargets = useMemo(() => {
    const current = `r/${targetId ?? ''}`.toLowerCase();
    const selected = new Set(selectedCompareTargets.map((item) => `r/${item}`.toLowerCase()));
    const candidates = [
      ...(marketData?.rankings.byHeat ?? []),
      ...(marketData?.rankings.bySurge ?? []),
    ];
    const seen = new Set<string>();
    return candidates
      .map((item) => item.canonicalName)
      .filter((canonicalName) => {
        const key = canonicalName.toLowerCase();
        if (key === current || selected.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [marketData, selectedCompareTargets, targetId]);

  const chartOptions = useMemo(
    () => buildTargetWorkbenchChartOptions({ data, activeSeries, hiddenOverlayIds }),
    [activeSeries, data, hiddenOverlayIds],
  );

  const comparisonChartOptions = useMemo(
    () => buildComparisonChartOptions(comparisonData),
    [comparisonData],
  );

  const toggleSeries = (seriesId: string) => {
    setActiveSeries((current) => {
      const next = new Set(current);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next.size > 0 ? next : current;
    });
  };

  const toggleOverlay = (overlayId: string) => {
    setHiddenOverlayIds((current) => {
      const next = new Set(current);
      if (next.has(overlayId)) {
        next.delete(overlayId);
      } else {
        next.add(overlayId);
      }
      return next;
    });
  };

  const applyKeywordOverlay = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    const normalized = overlayInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .join(',');
    if (normalized) {
      next.set('keywords', normalized);
    } else {
      next.delete('keywords');
    }
    setSearchParams(next);
  };

  const clearKeywordOverlay = () => {
    setOverlayInput('');
    const next = new URLSearchParams(searchParams);
    next.delete('keywords');
    setSearchParams(next);
  };

  const applyRange = (nextRange: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('range', nextRange);
    next.set('timeframe', timeframe);
    setSearchParams(next);
  };

  const applyComparison = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = compareInput
      .split(',')
      .map((value) => value.trim().replace(/^r\//i, ''))
      .filter(Boolean)
      .join(',');
    const next = new URLSearchParams(searchParams);
    if (normalized) {
      next.set('compare', normalized);
    } else {
      next.delete('compare');
    }
    setSearchParams(next);
  };

  const clearComparison = () => {
    setCompareInput('');
    const next = new URLSearchParams(searchParams);
    next.delete('compare');
    setSearchParams(next);
  };

  const addComparisonTarget = (canonicalName: string) => {
    const normalized = canonicalName.replace(/^r\//i, '');
    const targets = Array.from(new Set([...selectedCompareTargets, normalized]));
    const next = new URLSearchParams(searchParams);
    next.set('compare', targets.join(','));
    setCompareInput(targets.join(','));
    setSearchParams(next);
  };

  const removeComparisonTarget = (target: string) => {
    const targets = selectedCompareTargets.filter((item) => item !== target);
    const next = new URLSearchParams(searchParams);
    if (targets.length > 0) {
      next.set('compare', targets.join(','));
    } else {
      next.delete('compare');
    }
    setCompareInput(targets.join(','));
    setSearchParams(next);
  };

  const saveCurrentView = () => {
    if (!data) return;
    const compareTargets = selectedCompareTargets.map((target) => `r/${target}`);
    const keywordList = parseCsvList(keywords);
    const routePath = `${window.location.pathname}${window.location.search}`;
    saveViewMutation.mutate({
      name: compareTargets.length > 0
        ? `${data.target.canonicalName} comparison`
        : `${data.target.canonicalName} workbench`,
      viewKind: compareTargets.length > 0 ? 'comparison' : 'target',
      primaryTarget: data.target.canonicalName,
      compareTargets,
      keywords: keywordList,
      seriesIds: Array.from(activeSeries)
        .filter((seriesId): seriesId is NonNullable<CreateSavedWorkbenchViewRequest['seriesIds']>[number] =>
          ['heat_price', 'ema_7', 'ema_30', 'total_new_posts', 'qualified_post_count'].includes(seriesId),
        ),
      routePath,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <Link to="/dashboard" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>
              &larr; Back
            </Link>
            <h1 style={{ margin: 0 }} className="break-text">{data?.target.canonicalName ?? `r/${targetId}`}</h1>
            {data && <Badge variant="neutral">{data.range.rangePreset ?? `${data.range.dayCount}d`}</Badge>}
            {data && <Badge variant={data.dataQuality.status === 'complete' ? 'success' : 'neutral'}>{data.dataQuality.status}</Badge>}
            {data?.reliability.mode && <Badge variant="neutral">{data.reliability.mode}</Badge>}
          </div>
          <p className="page-subtitle">
            Target analytics workbench{keywords ? ` with keyword overlay: ${keywords}` : ''}
          </p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading workbench...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading workbench data.</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Latest Heat</div>
              <div className="kpi-value">{formatNumber(latestDailyPoint?.heatPrice)}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Daily Posts</div>
              <div className="kpi-value">{formatNumber(latestDailyPoint?.posts)}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Qualified Posts</div>
              <div className="kpi-value">{formatNumber(latestDailyPoint?.qualifiedPosts)}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Provider</div>
              <div className="kpi-value">{data.reliability.provider ?? 'n/a'}</div>
            </Card>
          </div>

          <Card style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <h3>Workbench Chart</h3>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {WORKBENCH_RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyRange(preset)}
                    style={{
                      backgroundColor: range === preset ? 'rgba(94, 106, 210, 0.16)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border-standard)',
                      borderRadius: '6px',
                      color: range === preset ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      minHeight: '32px',
                      padding: '6px 10px',
                    }}
                  >
                    {preset.toUpperCase()}
                  </button>
                ))}
                {data.availableTimeframes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => item.enabled && applyRange(range)}
                    disabled={!item.enabled}
                    title={item.reason}
                    style={{
                      backgroundColor: item.id === data.range.timeframe ? 'rgba(16, 185, 129, 0.14)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border-standard)',
                      borderRadius: '6px',
                      color: item.enabled ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      cursor: item.enabled ? 'pointer' : 'not-allowed',
                      fontSize: '13px',
                      minHeight: '32px',
                      opacity: item.enabled ? 1 : 0.54,
                      padding: '6px 10px',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                {data.series.map((series) => (
                  <label
                    key={series.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      color: activeSeries.has(series.id) ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      backgroundColor: activeSeries.has(series.id) ? 'rgba(94, 106, 210, 0.16)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--border-standard)',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      minHeight: '32px',
                      padding: '6px 10px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={activeSeries.has(series.id)}
                      onChange={() => toggleSeries(series.id)}
                    />
                    {series.label}
                  </label>
                ))}
              </div>
            </div>
            <form
              onSubmit={applyKeywordOverlay}
              style={{
                display: 'grid',
                gap: '10px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                marginBottom: '16px',
              }}
            >
              <label htmlFor="target-keyword-overlay" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Keyword overlays
              </label>
              <Input
                id="target-keyword-overlay"
                value={overlayInput}
                onChange={(event) => setOverlayInput(event.target.value)}
                placeholder="Add keyword overlays, comma separated"
                style={{ minWidth: 0 }}
              />
              <Button variant="primary" type="submit">Apply</Button>
              <Button type="button" onClick={clearKeywordOverlay}>Clear</Button>
            </form>
            <form
              onSubmit={applyComparison}
              style={{
                display: 'grid',
                gap: '10px',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                marginBottom: '16px',
              }}
            >
              <label htmlFor="target-comparison" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                Compare targets
              </label>
              <Input
                id="target-comparison"
                value={compareInput}
                onChange={(event) => setCompareInput(event.target.value)}
                placeholder="Compare with subreddits, comma separated"
                style={{ minWidth: 0 }}
              />
              <Button variant="primary" type="submit">Compare</Button>
              <Button type="button" onClick={clearComparison}>Clear</Button>
            </form>
            <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
              {selectedCompareTargets.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', fontWeight: 510 }}>Selected</span>
                  {selectedCompareTargets.map((target) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => removeComparisonTarget(target)}
                      style={{
                        backgroundColor: 'rgba(94, 106, 210, 0.16)',
                        border: '1px solid rgba(94, 106, 210, 0.45)',
                        borderRadius: '9999px',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        minHeight: '28px',
                        padding: '4px 10px',
                      }}
                    >
                      Remove r/{target}
                    </button>
                  ))}
                </div>
              )}
              {suggestedCompareTargets.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', fontWeight: 510 }}>Suggested comparisons</span>
                  {suggestedCompareTargets.map((canonicalName) => (
                    <button
                      key={canonicalName}
                      type="button"
                      onClick={() => addComparisonTarget(canonicalName)}
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border-standard)',
                        borderRadius: '9999px',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        minHeight: '28px',
                        padding: '4px 10px',
                      }}
                    >
                      Compare {canonicalName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 590 }}>Saved contexts</div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '2px' }}>
                    Preserve this chart state for later analysis.
                  </div>
                </div>
                <Button
                  type="button"
                  variant="subtle"
                  onClick={saveCurrentView}
                  disabled={saveViewMutation.isPending}
                >
                  {saveViewMutation.isPending ? 'Saving...' : 'Save view'}
                </Button>
              </div>
              {saveViewMutation.isSuccess && (
                <div style={{ color: 'var(--status-emerald)', fontSize: '12px' }}>Saved.</div>
              )}
              {saveViewMutation.isError && (
                <div style={{ color: '#ff4d4f', fontSize: '12px' }}>Could not save this view.</div>
              )}
              {savedViews && savedViews.views.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {savedViews.views.slice(0, 4).map((view) => (
                    <Link
                      key={view.id}
                      to={view.routePath}
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border-standard)',
                        borderRadius: '9999px',
                        color: 'var(--text-secondary)',
                        fontSize: '12px',
                        minHeight: '28px',
                        padding: '5px 10px',
                      }}
                    >
                      {view.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {data.queryContext.requested.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {data.queryContext.requested.map((query) => (
                  <Badge
                    key={`${query.queryScope}:${query.normalizedQueryText}`}
                    variant={query.hasOverlay ? 'success' : 'neutral'}
                  >
                    {query.normalizedQueryText} · {query.queryScope} · {query.matchedDriverCount} drivers
                  </Badge>
                ))}
              </div>
            )}
            {data.overlays.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {data.overlays.map((overlay) => (
                  <button
                    key={overlay.id}
                    type="button"
                    onClick={() => toggleOverlay(overlay.id)}
                    style={{
                      backgroundColor: hiddenOverlayIds.has(overlay.id) ? 'rgba(255,255,255,0.03)' : 'rgba(16, 185, 129, 0.14)',
                      border: '1px solid var(--border-standard)',
                      borderRadius: '6px',
                      color: hiddenOverlayIds.has(overlay.id) ? 'var(--text-tertiary)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      minHeight: '32px',
                      padding: '6px 10px',
                    }}
                  >
                    Keyword overlays: {overlay.label}
                  </button>
                ))}
              </div>
            )}
            <div className="chart-shell">
              <WorkbenchChart option={chartOptions} />
            </div>
          </Card>

          {comparisonData && (
            <Card style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
                <div>
                  <h3>Comparison</h3>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px', marginTop: '6px' }}>
                    Normalized index, first non-zero point = 100
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {comparisonData.targets.map((target) => (
                    <Badge key={target.targetId} variant="neutral">{target.canonicalName}</Badge>
                  ))}
                </div>
              </div>
              <div className="chart-shell">
                <WorkbenchChart option={comparisonChartOptions} />
              </div>
            </Card>
          )}

          <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <Card>
              <h3 style={{ marginBottom: '16px' }}>Driver Posts</h3>
              <div className="list-stack">
                {data.drivers.slice(0, 5).map((driver) => (
                  <a key={driver.id} href={`https://www.reddit.com${driver.permalink}`} target="_blank" rel="noreferrer" className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div className="break-text" style={{ color: 'var(--text-primary)', fontSize: '14px' }}>{driver.title}</div>
                    <div className="list-row-end">
                      <Badge variant="neutral">{formatNumber(driver.driverScore)}</Badge>
                      {(driver.matchedQueries ?? []).slice(0, 2).map((query) => (
                        <Badge key={query} variant="neutral">{query}</Badge>
                      ))}
                    </div>
                  </a>
                ))}
                {data.drivers.length === 0 && <div className="card-empty" style={{ padding: '20px' }}>No driver posts.</div>}
              </div>
            </Card>

            <Card>
              <h3 style={{ marginBottom: '16px' }}>Keyword Heat</h3>
              <div className="list-stack">
                {data.keywordHeat.slice(0, 6).map((keyword) => (
                  <div key={`${keyword.queryScope}:${keyword.keyword}`} className="list-row">
                    <div>
                      <div style={{ color: 'var(--text-primary)' }}>{keyword.keyword}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>{keyword.queryScope}</div>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>{formatNumber(keyword.totalMentions)}</div>
                  </div>
                ))}
                {data.keywordHeat.length === 0 && <div className="card-empty" style={{ padding: '20px' }}>No keyword heat.</div>}
              </div>
            </Card>

            <Card>
              <h3 style={{ marginBottom: '16px' }}>Reliability</h3>
              <div className="list-stack">
                <div className="list-row"><span>Provider</span><span>{data.reliability.provider ?? 'n/a'}</span></div>
                <div className="list-row"><span>Requests</span><span>{formatNumber(data.reliability.requestCount)}</span></div>
                <div className="list-row"><span>Successes</span><span>{formatNumber(data.reliability.successCount)}</span></div>
                <div className="list-row"><span>Errors</span><span>{formatNumber(data.reliability.errorCount)}</span></div>
                <div className="list-row"><span>Duplicate rate</span><span>{data.reliability.duplicatePostRate == null ? 'n/a' : `${formatNumber(data.reliability.duplicatePostRate * 100, 1)}%`}</span></div>
                <div className="list-row"><span>Avg lag</span><span>{data.reliability.ingestLagSecondsAvg == null ? 'n/a' : `${formatNumber(data.reliability.ingestLagSecondsAvg)}s`}</span></div>
              </div>
            </Card>

            <Card>
              <h3 style={{ marginBottom: '16px' }}>Anomalies</h3>
              <div className="list-stack">
                {data.anomalies.slice(0, 5).map((anomaly) => (
                  <div key={anomaly.eventId} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ color: 'var(--text-primary)' }}>{anomaly.signalKey}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>{anomaly.observedAt}</div>
                    </div>
                    <div className="list-row-end">
                      <Badge variant="neutral">{anomaly.signalType}</Badge>
                      <Badge variant={anomaly.severity === 'high' ? 'success' : 'neutral'}>{anomaly.severity}</Badge>
                    </div>
                  </div>
                ))}
                {data.anomalies.length === 0 && <div className="card-empty" style={{ padding: '20px' }}>No anomalies.</div>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
