import { useMemo, useState } from 'react';
import { ArrowRight, Layers, LayoutGrid, RefreshCw } from 'lucide-react';
import { formatApiError, useContentFacetsQuery } from '../api/hooks';
import { DailyTrendChart } from './charts/DailyTrendChart';
import { DistributionCards } from './charts/DistributionCharts';
import { KpiSparkChart } from './charts/KpiSparkChart';
import { useChartColors } from './charts/chartUtils';
import { type ContentKind, type OverviewFacet, type Platform, type Project, type PublicContent, formatContentAuthor } from '../contracts/api';
import { Alert } from './ui/alert';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { useI18n } from '../i18n/translations';

const PLATFORM_LABELS: Record<Platform, string> = {
  reddit: 'Reddit',
  x: 'X (Twitter)',
  bluesky: 'Bluesky',
  web: 'Web',
};

function platformMetricBadge(item: PublicContent): string {
  const m = item.observations[item.observations.length - 1]?.metrics ?? {};
  if (item.platform === 'reddit') {
    const score = m['reddit.score'] ?? '—';
    const comments = m['reddit.num_comments'] ?? '—';
    return `score ${score} · comments ${comments}`;
  }
  if (item.platform === 'x') {
    const likes = m['x.likes'] ?? '—';
    const reposts = m['x.reposts'] ?? '—';
    const views = m['x.views'];
    return `likes ${likes} · reposts ${reposts}${views !== null && views !== undefined ? ` · views ${views}` : ''}`;
  }
  if (item.platform === 'bluesky') {
    return `likes ${m['bluesky.likes'] ?? '—'} · replies ${m['bluesky.replies'] ?? '—'}`;
  }
  return item.kind;
}

export function CrossPlatformAnalyticsPanel({
  project,
  items,
  rangeDays,
  setRangeDays,
  from,
  to,
  threadAware,
  setThreadAware,
  kind,
  platforms,
  togglePlatform,
  providers,
  onDrilldown,
  onOpenContentDetail,
}: {
  project: Project;
  items: PublicContent[];
  rangeDays: 7 | 30 | 90;
  setRangeDays: (days: 7 | 30 | 90) => void;
  from: string;
  to: string;
  threadAware: boolean;
  setThreadAware: (enabled: boolean) => void;
  kind?: ContentKind;
  platforms: ReadonlySet<Platform>;
  togglePlatform: (platform: Platform) => void;
  providers: string[];
  onDrilldown: (projectId: string, extraQs?: string) => void;
  onOpenContentDetail: (contentId: string) => void;
}) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [viewMode, setViewMode] = useState<'combined' | 'split'>('combined');
  const [bucket, setBucket] = useState<'day' | '6h'>('day');
  const effectiveBucket = rangeDays === 7 ? bucket : 'day';
  const facetsQuery = useContentFacetsQuery({
    projectId: project.id,
    from,
    to,
    kind,
    bucket: effectiveBucket,
    threadAware,
  });

  const facets = facetsQuery.data;
  const availablePlatforms = useMemo(
    () => (facets?.distributions.platforms ?? []).map((p) => p.platform),
    [facets?.distributions.platforms],
  );
  const activePlatforms = useMemo(
    () => availablePlatforms.filter(platform => platforms.has(platform)),
    [availablePlatforms, platforms],
  );

  const drilldown = (platform?: Platform, start?: string) => {
    const startMs = start && Date.parse(start.length === 10 ? start + 'T00:00:00Z' : start + ':00:00Z');
    const interval = (effectiveBucket === '6h' ? 6 : 24) * 3_600_000;
    const params = new URLSearchParams({ from, to, threadAware: String(threadAware) });
    if (typeof startMs === 'number' && Number.isFinite(startMs)) {
      params.set('from', new Date(Math.max(startMs, Date.parse(from))).toISOString());
      params.set('to', new Date(Math.min(startMs + interval, Date.parse(to))).toISOString());
    }
    if (platform) params.set('platform', platform);
    else if (activePlatforms.length === 1) params.set('platform', activePlatforms[0]);
    if (kind) params.set('kind', kind);
    if (project.dataset_mode !== 'batch' && !project.include_push_in_trends) params.set('deliveryMode', 'pull');
    onDrilldown(project.id, params.toString());
  };

  // Build DailyTrendChart compatible buckets filtered by activePlatforms
  const trendBuckets = useMemo(() => {
    if (!facets) return [];
    const activeSet = new Set(activePlatforms);
    return facets.timeline.map((pt) => {
      const filtered = pt.byPlatform.filter((bp) => activeSet.has(bp.platform));
      return {
        day: pt.bucket.slice(0, effectiveBucket === '6h' ? 16 : 10),
        count: filtered.reduce((sum, bp) => sum + bp.count, 0),
        matchedContentCount: filtered.reduce((sum, bp) => sum + bp.matchedContentCount, 0),
      };
    });
  }, [facets, activePlatforms, effectiveBucket]);

  const trendByPlatform = useMemo(() => {
    if (!facets) return [];
    const activeSet = new Set(activePlatforms);
    const out: Array<{ day: string; platform: Platform; count: number; matchedContentCount: number }> = [];
    for (const pt of facets.timeline) {
      const day = pt.bucket.slice(0, effectiveBucket === '6h' ? 16 : 10);
      for (const bp of pt.byPlatform) {
        if (activeSet.has(bp.platform)) {
          out.push({ day, platform: bp.platform, count: bp.count, matchedContentCount: bp.matchedContentCount });
        }
      }
    }
    return out;
  }, [facets, activePlatforms, effectiveBucket]);

  const filteredPlatformDist = useMemo(() => {
    if (!facets) return [];
    const activeSet = new Set(activePlatforms);
    return facets.distributions.platforms.filter((p) => activeSet.has(p.platform));
  }, [facets, activePlatforms]);

  const totalCount = useMemo(
    () => filteredPlatformDist.reduce((sum, p) => sum + p.count, 0),
    [filteredPlatformDist],
  );
  const totalMatched = useMemo(
    () => filteredPlatformDist.reduce((sum, p) => sum + p.matchedContentCount, 0),
    [filteredPlatformDist],
  );

  const visibleItems = useMemo(
    () => items.filter(item => platforms.has(item.platform)),
    [items, platforms],
  );

  const overviewFacets = useMemo<OverviewFacet[]>(() => {
    const out: OverviewFacet[] = [
      { day_group: 1, platform_group: 1, kind_group: 1, day: null, platform: null, kind: null, count: totalCount, matchedContentCount: totalMatched },
    ];
    for (const tb of trendBuckets) {
      out.push({ day_group: 0, platform_group: 1, kind_group: 1, day: tb.day, platform: null, kind: null, count: tb.count, matchedContentCount: tb.matchedContentCount });
    }
    for (const pf of filteredPlatformDist) {
      out.push({ day_group: 1, platform_group: 0, kind_group: 1, day: null, platform: pf.platform, kind: null, count: pf.count, matchedContentCount: pf.matchedContentCount });
    }
    // The server kind facets span all platforms in the query.
    const kinds = activePlatforms.length === availablePlatforms.length ? facets?.distributions.kinds : [];
    for (const kd of kinds ?? []) {
      out.push({ day_group: 1, platform_group: 1, kind_group: 0, day: null, platform: null, kind: kd.kind, count: kd.count, matchedContentCount: kd.matchedContentCount });
    }
    return out;
  }, [totalCount, totalMatched, trendBuckets, filteredPlatformDist, facets?.distributions.kinds, activePlatforms.length, availablePlatforms.length]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Interactive Control Bar */}
      <Card className="ds-card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div className="seg" role="group" aria-label={t('Analytics view mode', '分析展示模式')}>
              <button type="button" className={viewMode === 'combined' ? 'on' : ''} aria-pressed={viewMode === 'combined'} onClick={() => setViewMode('combined')}>
                <Layers size={12} style={{ marginRight: 4 }} />
                {t('Combined Overview', '合并总览')}
              </button>
              <button type="button" className={viewMode === 'split' ? 'on' : ''} aria-pressed={viewMode === 'split'} onClick={() => setViewMode('split')}>
                <LayoutGrid size={12} style={{ marginRight: 4 }} />
                {t('Split by Platform', '分平台独立视图')}
              </button>
            </div>

            <div className="seg" role="group" aria-label={t('Time range', '时间窗口')}>
              {([7, 30, 90] as const).map((d) => (
                <button key={d} type="button" className={rangeDays === d ? 'on' : ''} aria-pressed={rangeDays === d} onClick={() => setRangeDays(d)}>
                  {d}d
                </button>
              ))}
            </div>

            {rangeDays === 7 && (
              <div className="seg" role="group" aria-label={t('Bucket granularity', '时间粒度')}>
                <button type="button" className={bucket === 'day' ? 'on' : ''} aria-pressed={bucket === 'day'} onClick={() => setBucket('day')}>{t('Daily', '按天')}</button>
                <button type="button" className={bucket === '6h' ? 'on' : ''} aria-pressed={bucket === '6h'} onClick={() => setBucket('6h')}>6h</button>
              </div>
            )}

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
              <input type="checkbox" checked={threadAware} onChange={(e) => setThreadAware(e.target.checked)} />
              <span>{t('Thread-aware count', '按讨论主题去重')}</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
            <span className="tag" style={{ fontSize: 10 }}>stored_sample</span>
            <span>{t('Count / Matched', '主题 / 节点')}: <b>{facets ? totalCount : '—'}</b> / {facets ? totalMatched : '—'}</span>
            {providers.length > 0 && <span>· {t('Project providers', '项目渠道')}: {providers.join(', ')}</span>}
            <Button type="button" variant="ghost" size="icon-sm"
              aria-label={t('Refresh analytics', '刷新分析')} onClick={() => void facetsQuery.refetch()}>
              <RefreshCw size={12} />
            </Button>
          </div>
        </div>

        {/* Platform Toggle Pills */}
        {availablePlatforms.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('Platforms', '包含平台')}:</span>
            {facets?.distributions.platforms.map((p) => {
              const checked = platforms.has(p.platform);
              return (
                <button
                  key={p.platform}
                  type="button"
                  className={`ds-btn ${checked ? '' : 'ds-btn--ghost'}`}
                  style={{ height: 24, fontSize: 11, padding: '0 10px' }}
                  aria-pressed={checked}
                  onClick={() => togglePlatform(p.platform)}
                >
                  {checked ? '✓ ' : ''}{PLATFORM_LABELS[p.platform]} ({p.count})
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* Charts Area: Combined vs Split by Platform */}
      {facetsQuery.isPending ? (
        <Skeleton className="project-overview-skeleton" role="status"
          aria-label={t('Loading analytics', '正在加载服务端分面聚合统计')} />
      ) : facetsQuery.isError ? (
        <Alert variant="destructive" role="alert">
          {formatApiError(facetsQuery.error)}
          <Button type="button" variant="outline" size="sm" onClick={() => void facetsQuery.refetch()}>{t('Retry', '重试')}</Button>
        </Alert>
      ) : totalCount === 0 ? (
        <div className="ds-card" style={{ padding: 24 }}>
          <b>{t('No matching samples in this window', '当前时间窗口内无匹配样本')}</b>
          <p className="collection-hint" style={{ marginTop: 4 }}>
            {project.dataset_mode === 'batch' && (project.enabled_batch_count ?? 0) === 0
              ? t('This project has no enabled data batches yet. Add or enable batches in Data Ingestion / Data Batches.', '该项目尚无已启用的数据批次，请前往「数据接入」或「数据批次」添加样本。')
              : t('Try expanding the window (30d / 90d) or enabling additional platforms.', '可尝试扩大时间窗口（30d / 90d）或勾选更多平台。')}
          </p>
        </div>
      ) : viewMode === 'combined' ? (
        <div className="ds-grid">
          <div className="c8">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div className="ds-card-title">{t('Combined Cross-Platform Trend', '合并趋势总览')}</div>
                <div className="ds-card-sub">{t(`Last ${rangeDays} days · ${effectiveBucket} buckets`, `近 ${rangeDays} 天 · ${effectiveBucket === '6h' ? '6 小时' : '按天'}分桶`)}</div>
              </div>
              <div className="ds-card-bd">
                <DailyTrendChart
                  facets={overviewFacets}
                  dayPlatformFacets={trendByPlatform}
                  rangeDays={rangeDays}
                  bucket={effectiveBucket}
                  threadAware={threadAware}
                  includePushInTrends={project.dataset_mode === 'batch' || project.include_push_in_trends}
                  onSelectDayPlatform={(start, platform) => drilldown(platform, start)}
                />
              </div>
            </div>
          </div>
          <div className="c4">
            <DistributionCards
              facets={overviewFacets}
              providers={providers}
              contentItems={visibleItems}
              onDrillPlatform={drilldown}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 14 }}>
          {filteredPlatformDist.map((pf) => {
            const series = (facets?.timeline ?? []).map((pt) => {
              const found = pt.byPlatform.find((bp) => bp.platform === pf.platform);
              return found?.count ?? null;
            });
            const pfItems = visibleItems.filter((item) => item.platform === pf.platform).slice(0, 5);
            return (
              <div key={pf.platform} className="ds-card">
                <div className="ds-card-hd" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div className="ds-card-title">{PLATFORM_LABELS[pf.platform]}</div>
                    <div className="ds-card-sub">
                      {pf.count} {t('threads/items', '主题/条目')} · {pf.matchedContentCount} {t('matched nodes', '命中节点')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    style={{ height: 26, fontSize: 11 }}
                    onClick={() => drilldown(pf.platform)}
                  >
                    <span>{t('Explore', '钻取')}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
                <div className="ds-card-bd" style={{ display: 'grid', gap: 10 }}>
                  <div style={{ height: 72 }}>
                    <KpiSparkChart values={series} color={colors.purple} />
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                    {t('Chart totals use full server facets; preview list shows up to 5 items from the latest 100 loaded.', '趋势与计数基于服务端全量分面聚合；下方仅预览当前已加载片段（最多 100 条）中的前 5 条。')}
                  </div>
                  {pfItems.length === 0 ? (
                    <p className="collection-hint">{t('No recent items in loaded slice.', '当前页暂无该平台样本。')}</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {pfItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onOpenContentDetail(item.id)}
                          style={{
                            textAlign: 'left',
                            padding: '7px 9px',
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            background: 'var(--bg)',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title || item.text?.slice(0, 80) || item.externalId}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
                            {formatContentAuthor(item.author)} · {platformMetricBadge(item)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
