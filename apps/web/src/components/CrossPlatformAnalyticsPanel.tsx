import { useMemo, useState } from 'react';
import { ArrowRight, Layers, LayoutGrid, RefreshCw, X } from 'lucide-react';
import { useContentFacetsQuery } from '../api/hooks';
import { DailyTrendChart } from './charts/DailyTrendChart';
import { DistributionCards } from './charts/DistributionCharts';
import { KpiSparkChart } from './charts/KpiSparkChart';
import { useChartColors } from './charts/chartUtils';
import { type OverviewFacet, type Platform, type Project, type PublicContent, formatContentAuthor } from '../contracts/api';
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
  providers,
  onDrilldown,
  onOpenContentDetail,
}: {
  project: Project;
  items: PublicContent[];
  providers: string[];
  onDrilldown: (projectId: string, extraQs?: string) => void;
  onOpenContentDetail: (contentId: string) => void;
}) {
  const { t } = useI18n();
  const colors = useChartColors();
  const [viewMode, setViewMode] = useState<'combined' | 'split'>('combined');
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [bucket, setBucket] = useState<'day' | '6h'>('day');
  const [threadAware, setThreadAware] = useState<boolean>(project.thread_aware);
  const [excludedPlatforms, setExcludedPlatforms] = useState<Set<Platform>>(() => new Set());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [anchorMs, setAnchorMs] = useState<number>(() => Math.floor(Date.now() / 60_000) * 60_000);
  const { fromIso, toIso } = useMemo(() => ({
    fromIso: new Date(anchorMs - rangeDays * 86_400_000).toISOString(),
    toIso: new Date(anchorMs).toISOString(),
  }), [anchorMs, rangeDays]);

  const effectiveBucket = rangeDays === 7 ? bucket : 'day';
  const facetsQuery = useContentFacetsQuery({
    projectId: project.id,
    from: fromIso,
    to: toIso,
    bucket: effectiveBucket,
    threadAware,
  });

  const facets = facetsQuery.data;
  const availablePlatforms = useMemo(
    () => (facets?.distributions.platforms ?? []).map((p) => p.platform),
    [facets?.distributions.platforms],
  );
  const activePlatforms = useMemo(
    () => availablePlatforms.filter((p) => !excludedPlatforms.has(p)),
    [availablePlatforms, excludedPlatforms],
  );

  const togglePlatform = (p: Platform) => {
    setExcludedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else if (availablePlatforms.length - next.size > 1) next.add(p);
      return next;
    });
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

  const visibleItems = useMemo(() => {
    const activeSet = new Set(activePlatforms);
    return items.filter((item) => {
      if (availablePlatforms.length > 0 && !activeSet.has(item.platform)) return false;
      if (selectedDay && !(item.publishedAt || item.firstFetchedAt).startsWith(selectedDay.slice(0, 10))) return false;
      return true;
    });
  }, [items, activePlatforms, availablePlatforms.length, selectedDay]);

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
    for (const kd of facets?.distributions.kinds ?? []) {
      out.push({ day_group: 1, platform_group: 1, kind_group: 0, day: null, platform: null, kind: kd.kind, count: kd.count, matchedContentCount: kd.matchedContentCount });
    }
    return out;
  }, [totalCount, totalMatched, trendBuckets, filteredPlatformDist, facets?.distributions.kinds]);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Interactive Control Bar */}
      <div className="ds-card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div className="seg" role="group" aria-label={t('Analytics view mode', '分析展示模式')}>
              <button type="button" className={viewMode === 'combined' ? 'on' : ''} onClick={() => setViewMode('combined')}>
                <Layers size={12} style={{ marginRight: 4 }} />
                {t('Combined Overview', '合并总览')}
              </button>
              <button type="button" className={viewMode === 'split' ? 'on' : ''} onClick={() => setViewMode('split')}>
                <LayoutGrid size={12} style={{ marginRight: 4 }} />
                {t('Split by Platform', '分平台独立视图')}
              </button>
            </div>

            <div className="seg" role="group" aria-label={t('Time range', '时间窗口')}>
              {([7, 30, 90] as const).map((d) => (
                <button key={d} type="button" className={rangeDays === d ? 'on' : ''} onClick={() => { setRangeDays(d); setSelectedDay(null); }}>
                  {d}d
                </button>
              ))}
            </div>

            {rangeDays === 7 && (
              <div className="seg" role="group" aria-label={t('Bucket granularity', '时间粒度')}>
                <button type="button" className={bucket === 'day' ? 'on' : ''} onClick={() => setBucket('day')}>{t('Daily', '按天')}</button>
                <button type="button" className={bucket === '6h' ? 'on' : ''} onClick={() => setBucket('6h')}>6h</button>
              </div>
            )}

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
              <input type="checkbox" checked={threadAware} onChange={(e) => setThreadAware(e.target.checked)} />
              <span>{t('Thread-aware count', '按讨论主题去重')}</span>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
            <span className="tag" style={{ fontSize: 10 }}>stored_sample</span>
            <span>{t('Count / Matched', '主题 / 节点')}: <b>{totalCount}</b> / {totalMatched}</span>
            {providers.length > 0 && <span>· {providers.join(', ')}</span>}
            <button type="button" className="ds-btn ds-btn--ghost" style={{ height: 26, fontSize: 11 }} onClick={() => { setAnchorMs(Math.floor(Date.now() / 60_000) * 60_000); void facetsQuery.refetch(); }}>
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Platform Toggle Pills */}
        {availablePlatforms.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('Platforms', '包含平台')}:</span>
            {facets?.distributions.platforms.map((p) => {
              const checked = !excludedPlatforms.has(p.platform);
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
            {selectedDay && (
              <button
                type="button"
                className="ds-btn ds-btn--ghost"
                style={{ height: 24, fontSize: 11, padding: '0 8px' }}
                onClick={() => setSelectedDay(null)}
              >
                <span>{t('Date', '日期')}: {selectedDay}</span>
                <X size={11} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Charts Area: Combined vs Split by Platform */}
      {facetsQuery.isPending ? (
        <div className="ds-card" style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
          {t('Loading real-time faceted analytics…', '正在加载服务端分面聚合统计…')}
        </div>
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
                  threadAware={threadAware}
                  includePushInTrends={project.dataset_mode === 'batch' || project.include_push_in_trends}
                  onSelectDayPlatform={(dayIso, platform) => {
                    setSelectedDay(dayIso.slice(0, 10));
                    if (platform) onDrilldown(project.id, `platform=${platform}`);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="c4">
            <DistributionCards
              facets={overviewFacets}
              providers={providers}
              contentItems={visibleItems}
              onDrillPlatform={(platform) => onDrilldown(project.id, `platform=${platform}`)}
            />
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
          {filteredPlatformDist.map((pf) => {
            const series = (facets?.timeline ?? []).map((pt) => {
              const found = pt.byPlatform.find((bp) => bp.platform === pf.platform);
              return found?.count ?? 0;
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
                    onClick={() => onDrilldown(project.id, `platform=${pf.platform}`)}
                  >
                    <span>{t('Explore', '钻取')}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
                <div className="ds-card-bd" style={{ display: 'grid', gap: 10 }}>
                  <div style={{ height: 72 }}>
                    <KpiSparkChart values={series.length ? series : [0]} color={colors.purple} />
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
