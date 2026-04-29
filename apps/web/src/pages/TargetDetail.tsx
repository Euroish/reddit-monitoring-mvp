import { useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Button, Input } from '../components/ui';
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
  SubredditAnomalyIncidentFeedResponse,
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
} from '../../../../packages/contracts/src/http';

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

const EMPTY_STRING_SET = new Set<string>();
type CompositionMode = 'listing' | 'classification' | 'engagement';
type CompositionSegment = {
  id: string;
  label: string;
  count: number;
  color: string;
};

const COMPOSITION_COLORS = ['#e9b64b', '#29d3c5', '#f46d43', '#80b7ff', '#74d87f', '#8f8a80'];

function toCompositionSegments(data: TargetWorkbenchResponse, mode: CompositionMode): CompositionSegment[] {
  const source = mode === 'listing'
    ? data.composition.listingMix
    : mode === 'classification'
      ? data.composition.classificationMix
      : data.composition.engagementMix;
  return source.map((item, index) => ({
    id: item.id,
    label: item.label,
    count: item.count,
    color: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length]!,
  }));
}

function buildConicGradient(segments: CompositionSegment[], activeId: string | null) {
  const total = segments.reduce((sum, item) => sum + item.count, 0);
  if (total <= 0) {
    return 'conic-gradient(rgba(255,255,255,0.12) 0deg 360deg)';
  }
  let cursor = 0;
  return `conic-gradient(${segments.map((segment) => {
    const start = cursor;
    const end = cursor + (segment.count / total) * 360;
    cursor = end;
    const color = activeId && activeId !== segment.id ? 'rgba(255,255,255,0.08)' : segment.color;
    return `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
  }).join(', ')})`;
}

function CompositionDonut({
  data,
  mode,
  activeId,
  onModeChange,
  onActiveChange,
}: {
  data: TargetWorkbenchResponse;
  mode: CompositionMode;
  activeId: string | null;
  onModeChange: (mode: CompositionMode) => void;
  onActiveChange: (id: string | null) => void;
}) {
  const segments = toCompositionSegments(data, mode);
  const total = segments.reduce((sum, item) => sum + item.count, 0);
  const activeSegment = segments.find((item) => item.id === activeId) ?? segments[0] ?? null;
  return (
    <div className="target-composition">
      <div className="target-composition-header">
        <div>
          <div className="target-eyebrow">Fetched mix</div>
          <h3>Composition</h3>
        </div>
        <div className="target-segment-switch">
          {(['listing', 'classification', 'engagement'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                onModeChange(item);
                onActiveChange(null);
              }}
              className={`target-control${mode === item ? ' active' : ''}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="target-donut-row">
        <button
          type="button"
          className="target-donut"
          style={{ background: buildConicGradient(segments, activeId) }}
          onMouseLeave={() => onActiveChange(null)}
          onClick={() => onActiveChange(activeSegment?.id ?? null)}
        >
          <span>
            <strong>{formatNumber(activeSegment?.count ?? total)}</strong>
            <em>{activeSegment ? activeSegment.label : 'Fetched'}</em>
          </span>
        </button>
        <div className="target-donut-legend">
          {segments.map((segment) => {
            const pct = total > 0 ? (segment.count / total) * 100 : 0;
            return (
              <button
                key={segment.id}
                type="button"
                className={`target-donut-legend-row${activeId === segment.id ? ' active' : ''}`}
                onMouseEnter={() => onActiveChange(segment.id)}
                onFocus={() => onActiveChange(segment.id)}
                onClick={() => onActiveChange(activeId === segment.id ? null : segment.id)}
              >
                <span className="target-donut-dot" style={{ background: segment.color }} />
                <span>{segment.label}</span>
                <strong>{formatNumber(segment.count)}</strong>
                <em>{formatNumber(pct, 1)}%</em>
              </button>
            );
          })}
        </div>
      </div>
      <p>{data.composition.ruleLabel}</p>
    </div>
  );
}

export function TargetDetail() {
  const { targetId } = useParams<{ targetId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const keywordSource = searchParams.get('keywords') ?? '';
  const keywords = keywordSource || null;
  const range = normalizeWorkbenchRange(searchParams.get('range'));
  const timeframe = '1d' as const;
  const compare = searchParams.get('compare');
  const [overlayDraft, setOverlayDraft] = useState({ source: keywordSource, value: keywordSource });
  const [compareDraft, setCompareDraft] = useState({ source: compare ?? '', value: compare ?? '' });
  const [seriesSelection, setSeriesSelection] = useState<{ targetId: string | undefined; values: Set<string> }>({
    targetId: undefined,
    values: new Set(),
  });
  const [hiddenOverlayState, setHiddenOverlayState] = useState<{ source: string; values: Set<string> }>({
    source: keywordSource,
    values: new Set(),
  });
  const [compositionMode, setCompositionMode] = useState<CompositionMode>('listing');
  const [activeCompositionId, setActiveCompositionId] = useState<string | null>(null);

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
  const { data: incidentData } = useQuery({
    queryKey: ['target-anomaly-incidents', targetId],
    queryFn: () =>
      fetchApi<SubredditAnomalyIncidentFeedResponse>(`/v1/trends/subreddit/${targetId}/anomalies/incidents?limit=6`),
    enabled: !!targetId,
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

  const overlayInput = overlayDraft.source === keywordSource ? overlayDraft.value : keywordSource;
  const compareInput = compareDraft.source === (compare ?? '') ? compareDraft.value : compare ?? '';
  const activeSeries = useMemo(
    () => data && seriesSelection.targetId === data.target.targetId
      ? seriesSelection.values
      : createInitialSeriesSelection(data),
    [data, seriesSelection],
  );
  const hiddenOverlayIds = hiddenOverlayState.source === keywordSource
    ? hiddenOverlayState.values
    : EMPTY_STRING_SET;

  const latestDailyPoint = useMemo(() => {
    if (!data?.series.length) return null;
    const latestIndex = Math.max(0, data.series[0]?.points.length ?? 0) - 1;
    const valueFor = (seriesId: string) =>
      data.series.find((series) => series.id === seriesId)?.points[latestIndex]?.value ?? null;
    return {
      heatPrice: valueFor('heat_price'),
      posts: valueFor('total_new_posts'),
      qualifiedPosts: valueFor('qualified_post_count'),
      postsLabel: 'Fetched Posts',
      qualifiedPostsLabel: 'Qualified Posts',
    };
  }, [data]);

  const selectedCompareTargets = parseCompareTargets(compare);
  const suggestedCompareTargets = (() => {
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
  })();

  const chartOptions = useMemo(
    () => buildTargetWorkbenchChartOptions({ data, activeSeries, hiddenOverlayIds }),
    [activeSeries, data, hiddenOverlayIds],
  );

  const comparisonChartOptions = useMemo(
    () => buildComparisonChartOptions(comparisonData),
    [comparisonData],
  );

  const toggleSeries = (seriesId: string) => {
    setSeriesSelection((current) => {
      const currentValues = data && current.targetId === data.target.targetId
        ? current.values
        : createInitialSeriesSelection(data);
      const next = new Set(currentValues);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return {
        targetId: data?.target.targetId,
        values: next.size > 0 ? next : currentValues,
      };
    });
  };

  const toggleOverlay = (overlayId: string) => {
    setHiddenOverlayState((current) => {
      const source = keywordSource;
      const currentValues = current.source === source ? current.values : new Set<string>();
      const next = new Set(currentValues);
      if (next.has(overlayId)) {
        next.delete(overlayId);
      } else {
        next.add(overlayId);
      }
      return { source, values: next };
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
    setOverlayDraft({ source: normalized, value: normalized });
    setSearchParams(next);
  };

  const clearKeywordOverlay = () => {
    setOverlayDraft({ source: '', value: '' });
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
    setCompareDraft({ source: normalized, value: normalized });
    setSearchParams(next);
  };

  const clearComparison = () => {
    setCompareDraft({ source: '', value: '' });
    const next = new URLSearchParams(searchParams);
    next.delete('compare');
    setSearchParams(next);
  };

  const addComparisonTarget = (canonicalName: string) => {
    const normalized = canonicalName.replace(/^r\//i, '');
    const targets = Array.from(new Set([...selectedCompareTargets, normalized]));
    const next = new URLSearchParams(searchParams);
    next.set('compare', targets.join(','));
    setCompareDraft({ source: targets.join(','), value: targets.join(',') });
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
    setCompareDraft({ source: targets.join(','), value: targets.join(',') });
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
          [
            'heat_price',
            'ema_7',
            'ema_30',
            'activity_index',
            'qualified_activity_index',
            'activity_confidence',
            'observed_new_posts',
            'observed_qualified_posts',
            'total_new_posts',
            'qualified_post_count',
          ].includes(seriesId),
        ),
      routePath,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <Link to="/markets" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>
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
        <div className="target-workbench">
          <section className="target-command target-command-recovered">
            <div className="target-hero-band">
              <div className="target-hero-copy">
                <div className="target-eyebrow">Trading desk</div>
                <h2>{data.target.canonicalName} capture surface</h2>
                <p>
                  Total fetched pool, qualified signal, and driver fallback are promoted to the primary readout.
                </p>
              </div>
              <div className="target-hero-stats">
                <div className="target-metric target-metric-major">
                  <div className="target-metric-label">{latestDailyPoint?.postsLabel ?? 'Fetched Posts'}</div>
                  <div className="target-metric-value">{formatNumber(data.composition.fetchedPostCount || latestDailyPoint?.posts)}</div>
                  <div className="target-metric-caption">All captured listing lanes in range</div>
                </div>
                <div className="target-metric target-metric-major qualified">
                  <div className="target-metric-label">{latestDailyPoint?.qualifiedPostsLabel ?? 'Qualified Posts'}</div>
                  <div className="target-metric-value">{formatNumber(data.composition.qualifiedPostCount || latestDailyPoint?.qualifiedPosts)}</div>
                  <div className="target-metric-caption">Widened qualification rule</div>
                </div>
                <div className="target-metric">
                  <div className="target-metric-label">Drivers</div>
                  <div className="target-metric-value">{formatNumber(data.drivers.length)}</div>
                  <div className="target-metric-caption">Growth facts or hot-listing fallback</div>
                </div>
                <div className="target-metric">
                  <div className="target-metric-label">Heat</div>
                  <div className="target-metric-value">{formatNumber(latestDailyPoint?.heatPrice)}</div>
                  <div className="target-metric-caption">{data.reliability.provider ?? 'provider n/a'}</div>
                </div>
              </div>
              <CompositionDonut
                data={data}
                mode={compositionMode}
                activeId={activeCompositionId}
                onModeChange={setCompositionMode}
                onActiveChange={setActiveCompositionId}
              />
            </div>

            <div className="target-chart-stage">
              <div className="target-chart-toolbar">
                <div className="target-chart-title">
                  <h3>Workbench Chart</h3>
                  <p>Captured-day volume and heat movement, with draggable time scale and crosshair readout.</p>
                </div>
                <div className="target-control-cloud">
                {WORKBENCH_RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyRange(preset)}
                    className={`target-control${range === preset ? ' active' : ''}`}
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
                    className={`target-control${item.id === data.range.timeframe ? ' active' : ''}`}
                  >
                    {item.label}
                  </button>
                ))}
                {data.series.map((series) => (
                  <label
                    key={series.id}
                    className={`target-control${activeSeries.has(series.id) ? ' active' : ''}`}
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
            <div className="target-inline-forms">
              <form onSubmit={applyKeywordOverlay} className="target-inline-form">
                <label htmlFor="target-keyword-overlay" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                  Keyword overlays
                </label>
                <Input
                  id="target-keyword-overlay"
                  value={overlayInput}
                  onChange={(event) => setOverlayDraft({ source: keywordSource, value: event.target.value })}
                  placeholder="Add keyword overlays, comma separated"
                  style={{ minWidth: 0 }}
                />
                <Button variant="primary" type="submit">Apply</Button>
                <Button type="button" onClick={clearKeywordOverlay}>Clear</Button>
              </form>
              <form onSubmit={applyComparison} className="target-inline-form">
                <label htmlFor="target-comparison" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                  Compare targets
                </label>
                <Input
                  id="target-comparison"
                  value={compareInput}
                  onChange={(event) => setCompareDraft({ source: compare ?? '', value: event.target.value })}
                  placeholder="Compare with subreddits, comma separated"
                  style={{ minWidth: 0 }}
                />
                <Button variant="primary" type="submit">Compare</Button>
                <Button type="button" onClick={clearComparison}>Clear</Button>
              </form>
            </div>
            <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
              {selectedCompareTargets.length > 0 && (
                <div className="target-context-strip">
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', fontWeight: 510 }}>Selected</span>
                  {selectedCompareTargets.map((target) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => removeComparisonTarget(target)}
                      className="target-chip active"
                    >
                      Remove r/{target}
                    </button>
                  ))}
                </div>
              )}
              {suggestedCompareTargets.length > 0 && (
                <div className="target-context-strip">
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '12px', fontWeight: 510 }}>Suggested comparisons</span>
                  {suggestedCompareTargets.map((canonicalName) => (
                    <button
                      key={canonicalName}
                      type="button"
                      onClick={() => addComparisonTarget(canonicalName)}
                      className="target-chip"
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
                <div className="target-context-strip">
                  {savedViews.views.slice(0, 4).map((view) => (
                    <Link
                      key={view.id}
                      to={view.routePath}
                      className="target-chip"
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
              <div className="target-context-strip">
                {data.overlays.map((overlay) => (
                  <button
                    key={overlay.id}
                    type="button"
                    onClick={() => toggleOverlay(overlay.id)}
                    className={`target-chip${hiddenOverlayIds.has(overlay.id) ? '' : ' active'}`}
                  >
                    Keyword overlays: {overlay.label}
                  </button>
                ))}
              </div>
            )}
            <div className="chart-shell">
              <WorkbenchChart option={chartOptions} />
            </div>
            <div className="target-note-line">
              Coverage {data.dataQuality.coverage.observedPostDayCount}/{data.dataQuality.coverage.expectedDayCount} captured days
              {' '}· Complete {data.dataQuality.coverage.completeCoverageDayCount ?? 0}
              {' '}· Partial {data.dataQuality.coverage.partialCoverageDayCount ?? 0}
              {' '}· Source-limited {data.dataQuality.coverage.sourceLimitedDayCount ?? 0}
              {' '}· Median {formatNumber(data.dataQuality.coverage.observedPostMedian)} captured posts/day
              {' '}· Low-density {data.dataQuality.coverage.lowObservedPostDayCount} days
              {data.dataQuality.coverage.degradedReasons.length > 0
                ? ` · ${data.dataQuality.coverage.degradedReasons.join(', ')}`
                : ''}
            </div>
            {data.dataQuality.notes.length > 0 && (
              <div className="target-note-line">
                {data.dataQuality.notes.join(' ')}
              </div>
            )}
            </div>
          </section>

          {comparisonData && (
            <section className="target-panel">
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
            </section>
          )}

          <div className="target-panel-grid">
            <div className="target-panel-column">
              <section className="target-panel">
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
              </section>

              <section className="target-panel">
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
              </section>
            </div>

            <div className="target-panel-column">
              <section className="target-panel">
              <h3 style={{ marginBottom: '16px' }}>Reliability</h3>
              <div className="list-stack">
                <div className="list-row"><span>Provider</span><span>{data.reliability.provider ?? 'n/a'}</span></div>
                <div className="list-row"><span>Requests</span><span>{formatNumber(data.reliability.requestCount)}</span></div>
                <div className="list-row"><span>Successes</span><span>{formatNumber(data.reliability.successCount)}</span></div>
                <div className="list-row"><span>Errors</span><span>{formatNumber(data.reliability.errorCount)}</span></div>
                <div className="list-row"><span>Duplicate rate</span><span>{data.reliability.duplicatePostRate == null ? 'n/a' : `${formatNumber(data.reliability.duplicatePostRate * 100, 1)}%`}</span></div>
                <div className="list-row"><span>Avg lag</span><span>{data.reliability.ingestLagSecondsAvg == null ? 'n/a' : `${formatNumber(data.reliability.ingestLagSecondsAvg)}s`}</span></div>
              </div>
              </section>

              <section className="target-panel">
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
              </section>

              <section className="target-panel">
              <h3 style={{ marginBottom: '16px' }}>Incidents</h3>
              <div className="list-stack">
                {(incidentData?.incidents ?? []).slice(0, 5).map((incident) => (
                  <div key={incident.incidentId} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ color: 'var(--text-primary)' }}>{incident.dominantSignalType}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px' }}>
                        {new Date(incident.windowStart).toLocaleString()} to {new Date(incident.windowEnd).toLocaleString()}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', marginTop: '4px' }}>
                        {incident.signalCount} signals · merged {incident.mergedScore.toFixed(2)}
                      </div>
                    </div>
                    <div className="list-row-end">
                      <Badge variant={incident.severity === 'high' ? 'success' : 'neutral'}>{incident.severity}</Badge>
                    </div>
                  </div>
                ))}
                {(incidentData?.incidents.length ?? 0) === 0 && <div className="card-empty" style={{ padding: '20px' }}>No incidents.</div>}
              </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
