import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { fetchApi } from '../api/client';
import { Card, Badge, Button, Input } from '../components/ui';
import type {
  MarketTrendResponse,
  TargetComparisonWorkbenchResponse,
  TargetWorkbenchResponse,
} from '../../../../packages/contracts/src/http';

echarts.use([GridComponent, LegendComponent, LineChart, SVGRenderer, TooltipComponent]);

const DEFAULT_SERIES = new Set(['heat_price', 'ema_7', 'ema_30']);
const SERIES_COLORS: Record<string, string> = {
  heat_price: '#5e6ad2',
  ema_7: '#a07cc6',
  ema_30: '#6f7785',
  total_new_posts: '#10b981',
  qualified_post_count: '#f59f00',
};

function buildWorkbenchPath(targetId: string | undefined, keywords: string | null) {
  const params = new URLSearchParams({
    driverLimit: '8',
    anomalyLimit: '8',
  });
  if (keywords?.trim()) {
    params.set('keywords', keywords.trim());
  }
  return `/v1/workbench/target/${targetId}?${params.toString()}`;
}

function buildComparisonPath(targetId: string | undefined, compare: string | null) {
  const comparisonTargets = [
    targetId,
    ...(compare ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  ].filter(Boolean);
  const params = new URLSearchParams({
    targets: comparisonTargets.join(','),
    series: 'heat_price,total_new_posts',
  });
  return `/v1/workbench/compare?${params.toString()}`;
}

function WorkbenchChart({ option }: { option: EChartsOption }) {
  const chartElementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartElementRef.current) return;

    const chart = echarts.init(chartElementRef.current, undefined, { renderer: 'svg' });
    chart.setOption(option, true);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartElementRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  return <div ref={chartElementRef} style={{ height: '100%', width: '100%' }} />;
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
}

function parseCompareTargets(value: string | null) {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim().replace(/^r\//i, ''))
        .filter(Boolean),
    ),
  );
}

export function TargetDetail() {
  const { targetId } = useParams<{ targetId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const keywords = searchParams.get('keywords');
  const [overlayInput, setOverlayInput] = useState(keywords ?? '');
  const compare = searchParams.get('compare');
  const [compareInput, setCompareInput] = useState(compare ?? '');
  const [activeSeries, setActiveSeries] = useState<Set<string>>(new Set(DEFAULT_SERIES));
  const [hiddenOverlayIds, setHiddenOverlayIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ['target-workbench', targetId, keywords],
    queryFn: () => fetchApi<TargetWorkbenchResponse>(buildWorkbenchPath(targetId, keywords)),
    enabled: !!targetId,
  });

  const { data: comparisonData } = useQuery({
    queryKey: ['target-comparison-workbench', targetId, compare],
    queryFn: () => fetchApi<TargetComparisonWorkbenchResponse>(buildComparisonPath(targetId, compare)),
    enabled: !!targetId && !!compare?.trim(),
  });

  const { data: marketData } = useQuery({
    queryKey: ['market-trend'],
    queryFn: () => fetchApi<MarketTrendResponse>('/v1/trends/market'),
  });

  useEffect(() => {
    setOverlayInput(keywords ?? '');
    setHiddenOverlayIds(new Set());
  }, [keywords]);

  useEffect(() => {
    setCompareInput(compare ?? '');
  }, [compare]);

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

  const chartOptions = useMemo<EChartsOption>(() => {
    if (!data || data.series.length === 0) return {};

    const dates = data.series[0]?.points.map((point) => point.at) ?? [];
    const visibleSeries = data.series.filter((series) => activeSeries.has(series.id));
    const chartSeries = visibleSeries.map((series) => ({
      name: series.label,
      type: 'line' as const,
      data: series.points.map((point) => point.value),
      smooth: true,
      showSymbol: false,
      itemStyle: { color: SERIES_COLORS[series.id] ?? '#8a8f98' },
      lineStyle: {
        width: series.id === 'heat_price' ? 3 : 2,
        type: series.id.startsWith('ema_') ? 'dashed' as const : 'solid' as const,
      },
    }));
    const overlaySeries = data.overlays.filter((overlay) => !hiddenOverlayIds.has(overlay.id)).slice(0, 3).map((overlay) => ({
      name: overlay.label,
      type: 'line' as const,
      data: overlay.points.map((point) => point.value),
      smooth: true,
      showSymbol: false,
      yAxisIndex: 1,
      itemStyle: { color: '#e879f9' },
      lineStyle: { width: 1.5, type: 'dotted' as const },
    }));

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(23, 24, 25, 0.94)',
        borderColor: '#2b2d31',
        textStyle: { color: '#eeeeee' },
      },
      legend: {
        data: [...chartSeries, ...overlaySeries].map((series) => series.name),
        textStyle: { color: '#888888' },
        bottom: 0,
      },
      grid: {
        left: '3%',
        right: '5%',
        bottom: '12%',
        top: '4%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: '#2b2d31' } },
        axisLabel: { color: '#888888' },
      },
      yAxis: [
        {
          type: 'value',
          splitLine: { lineStyle: { color: '#1a1b1e' } },
          axisLabel: { color: '#888888' },
        },
        {
          type: 'value',
          splitLine: { show: false },
          axisLabel: { color: '#8a8f98' },
        },
      ],
      series: [...chartSeries, ...overlaySeries],
    };
  }, [activeSeries, data, hiddenOverlayIds]);

  const comparisonChartOptions = useMemo<EChartsOption>(() => {
    if (!comparisonData || comparisonData.comparisons.length === 0) return {};
    const dates = comparisonData.comparisons[0]?.points.map((point) => point.at) ?? [];
    const palette = ['#5e6ad2', '#10b981', '#f59f00', '#e879f9', '#38bdf8', '#f43f5e'];
    const chartSeries = comparisonData.comparisons.map((comparison, index) => {
      const seriesLabel = comparisonData.series.find((series) => series.id === comparison.seriesId)?.label ?? comparison.seriesId;
      return {
        name: `${comparison.canonicalName} ${seriesLabel}`,
        type: 'line' as const,
        data: comparison.points.map((point) => point.normalizedValue),
        smooth: true,
        showSymbol: false,
        itemStyle: { color: palette[index % palette.length] },
        lineStyle: {
          width: comparison.seriesId === 'heat_price' ? 2.5 : 1.5,
          type: comparison.seriesId === 'heat_price' ? 'solid' as const : 'dashed' as const,
        },
      };
    });
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(23, 24, 25, 0.94)',
        borderColor: '#2b2d31',
        textStyle: { color: '#eeeeee' },
      },
      legend: {
        data: chartSeries.map((series) => series.name),
        textStyle: { color: '#888888' },
        bottom: 0,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '4%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: '#2b2d31' } },
        axisLabel: { color: '#888888' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#1a1b1e' } },
        axisLabel: { color: '#888888', formatter: '{value}' },
      },
      series: chartSeries,
    };
  }, [comparisonData]);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <Link to="/dashboard" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>
              &larr; Back
            </Link>
            <h1 style={{ margin: 0 }} className="break-text">{data?.target.canonicalName ?? `r/${targetId}`}</h1>
            {data && <Badge variant="neutral">{data.range.dayCount}d</Badge>}
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
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
