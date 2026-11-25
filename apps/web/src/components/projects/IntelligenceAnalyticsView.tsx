import { useMemo, useState } from 'react';
import {
  Activity,
  ExternalLink,
  Globe,
  RefreshCw,
  Users,
} from 'lucide-react';
import {
  formatApiError,
  useAuthorProfileQuery,
  useCommunityDeepDiveQuery,
  useMonitoredCommunitiesQuery,
  useMonitorOverviewQuery,
  useMonitorPostsQuery,
  useTrackedAuthorsQuery,
} from '../../api/hooks';
import type { IntelMonitorDto, PeriodDeltaDto } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';
import { formatExactTime, safeHttpUrl } from '../../lib/sourceLabels';
import { KpiCard } from '../workbench/KpiCard';
import { Badge } from '../ui/badge';
import { MonitorTimelineSvg, PostingHeatmapGrid, SubredditQuadrantSvg } from './IntelCharts';

interface IntelligenceAnalyticsViewProps {
  monitors: IntelMonitorDto[];
  projectId?: string;
  initialMonitorId?: string;
  onNavigate?: (path: string) => void;
  onOpenContentDetail?: (contentId: string) => void;
}

function formatDeltaText(delta: PeriodDeltaDto, t: (en: string, zh: string) => string): string {
  if (delta.status === 'unknown') return t('No prior baseline', '无前周期对照');
  if (delta.status === 'new') return t('New vs 0 prior', '新增（前窗为 0）');
  if (delta.deltaPct === null) return `${delta.status}`;
  const pct = (delta.deltaPct * 100).toFixed(1);
  return `${delta.deltaPct > 0 ? '+' : ''}${pct}% vs prior`;
}

export function IntelligenceAnalyticsView({
  monitors,
  projectId,
  initialMonitorId,
  onNavigate,
  onOpenContentDetail,
}: IntelligenceAnalyticsViewProps) {
  const { t } = useI18n();
  const projectScopedMonitors = useMemo(() => {
    const linked = projectId ? monitors.filter((m) => m.projectId === projectId) : [];
    return linked.length ? linked : monitors;
  }, [monitors, projectId]);

  const [selectedMonitorId, setSelectedMonitorId] = useState<string>(() =>
    initialMonitorId && monitors.some((m) => m.id === initialMonitorId)
      ? initialMonitorId
      : projectScopedMonitors[0]?.id ?? '',
  );
  const effectiveMonitorId =
    monitors.some((m) => m.id === selectedMonitorId) ? selectedMonitorId : projectScopedMonitors[0]?.id ?? '';

  const [subTab, setSubTab] = useState<'overview' | 'authors' | 'communities'>('overview');
  const [days, setDays] = useState<7 | 14 | 30 | 90>(14);
  const [bucket, setBucket] = useState<'6h' | '1d'>('1d');
  const [postSort, setPostSort] = useState<'heat' | 'score' | 'comments' | 'views' | 'newest'>('heat');
  const [filterDomain, setFilterDomain] = useState<string>('');
  const [filterIntent, setFilterIntent] = useState<string>('');
  const [postOffset, setPostOffset] = useState(0);

  const [authorPlatform, setAuthorPlatform] = useState<'' | 'reddit' | 'x'>('');
  const [authorSort, setAuthorSort] = useState<'followers' | 'engagement' | 'posts'>('engagement');
  const [authorSearch, setAuthorSearch] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState<{ platform: 'reddit' | 'x'; handle: string } | null>(null);

  const [selectedSubreddit, setSelectedSubreddit] = useState<string | null>(null);

  const overviewQ = useMonitorOverviewQuery(subTab === 'overview' ? effectiveMonitorId : undefined, days, bucket);
  const postsQ = useMonitorPostsQuery(subTab === 'overview' ? effectiveMonitorId : undefined, {
    sort: postSort,
    domain: filterDomain || undefined,
    intent: filterIntent || undefined,
    days,
    limit: 20,
    offset: postOffset,
  });

  const authorsQ = useTrackedAuthorsQuery(
    {
      monitorId: effectiveMonitorId || undefined,
      platform: authorPlatform || undefined,
      sort: authorSort,
      search: authorSearch.trim() || undefined,
      limit: 40,
    },
    subTab === 'authors' && Boolean(effectiveMonitorId),
  );
  const authorProfileQ = useAuthorProfileQuery(
    selectedAuthor?.platform,
    selectedAuthor?.handle,
    { days, monitorId: effectiveMonitorId || undefined },
  );

  const communitiesQ = useMonitoredCommunitiesQuery(
    { monitorId: effectiveMonitorId || undefined, days, sort: 'heat', limit: 40 },
    subTab === 'communities' && Boolean(effectiveMonitorId),
  );
  const activeCommunity = selectedSubreddit ?? communitiesQ.data?.items[0]?.subreddit ?? undefined;
  const communityDeepQ = useCommunityDeepDiveQuery(
    subTab === 'communities' ? activeCommunity : undefined,
    { days, monitorId: effectiveMonitorId || undefined },
  );

  if (monitors.length === 0) {
    return (
      <div className="wb-card" style={{ padding: 28, textAlign: 'center', display: 'grid', gap: 10 }}>
        <strong>{t('No intelligence monitors configured yet', '当前项目或账号下暂无智能监测器')}</strong>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          {t(
            'Create a keyword, author list, or community bundle monitor from Project Overview to unlock SoV, GEO domains, KOL profiles and Subreddit heatmaps.',
            '请先在「项目总览」的智能监测调度卡片中创建关键词、作者列表或社区包监测器，即可解锁 SoV、GEO 外链、KOL 画像与 Subreddit 热力图分析。',
          )}
        </p>
        {onNavigate && (
          <div>
            <button
              type="button"
              className="ds-btn"
              onClick={() => onNavigate(projectId ? `/projects?view=overview&projectId=${encodeURIComponent(projectId)}` : '/projects?view=overview')}
            >
              {t('Go to Project Overview', '前往项目总览创建监测器')}
            </button>
          </div>
        )}
      </div>
    );
  }

  const ov = overviewQ.data;
  const maxSovMentions = Math.max(1, ...(ov?.shareOfVoice.map((s) => s.mentions) ?? [1]));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Monitor & Window Controls */}
      <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Activity size={15} />
            <select
              className="wb-select"
              aria-label={t('Select monitor', '选择智能监测器')}
              value={effectiveMonitorId}
              onChange={(e) => {
                setSelectedMonitorId(e.target.value);
                setSelectedAuthor(null);
                setSelectedSubreddit(null);
                setPostOffset(0);
              }}
              style={{ minWidth: 220 }}
            >
              {monitors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.kind}{m.projectId === projectId ? ' · 项目已绑定' : ''})
                </option>
              ))}
            </select>

            <div className="seg" role="tablist" aria-label={t('Intelligence analytics views', '分析视角')}>
              <button type="button" className={subTab === 'overview' ? 'on' : ''} onClick={() => setSubTab('overview')}>
                {t('Overview · SoV & GEO', '总览 · SoV 与 GEO')}
              </button>
              <button type="button" className={subTab === 'authors' ? 'on' : ''} onClick={() => setSubTab('authors')}>
                {t('KOL / Authors', 'KOL 与作者画像')}
              </button>
              <button type="button" className={subTab === 'communities' ? 'on' : ''} onClick={() => setSubTab('communities')}>
                {t('Subreddit Matrix', 'Subreddit 四象限与热力图')}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="seg">
              {([7, 14, 30, 90] as const).map((d) => (
                <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => { setPostOffset(0); setDays(d); }}>
                  {d}d
                </button>
              ))}
            </div>
            {subTab === 'overview' && (
              <div className="seg">
                {(['6h', '1d'] as const).map((b) => (
                  <button key={b} type="button" className={bucket === b ? 'on' : ''} onClick={() => setBucket(b)}>
                    {b}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="ds-btn ds-btn--ghost"
              onClick={() => {
                if (subTab === 'overview') { void overviewQ.refetch(); void postsQ.refetch(); }
                if (subTab === 'authors') void authorsQ.refetch();
                if (subTab === 'communities') void communitiesQ.refetch();
              }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {ov && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: 'var(--muted)' }} className="tabular-nums">
            <Badge variant="secondary">coverage: {ov.coverage.model}</Badge>
            <span>{t(`Sample: ${ov.coverage.sampleSize} posts`, `已存样本：${ov.coverage.sampleSize} 条`)}</span>
            <span>·</span>
            <span>{t(`Sources: ${ov.coverage.activeSources}/${ov.coverage.totalSources} active`, `来源：${ov.coverage.activeSources}/${ov.coverage.totalSources} 启用`)}</span>
            {ov.coverage.failedSources > 0 && (
              <span className="tag tag--amber">{t(`${ov.coverage.failedSources} source failures`, `${ov.coverage.failedSources} 个来源最近失败`)}</span>
            )}
            <span>·</span>
            <span>{t('Last success', '最近成功')}: {ov.coverage.lastSuccessAt ? formatExactTime(ov.coverage.lastSuccessAt) : t('Not yet run', '尚无成功采集')}</span>
          </div>
        )}
      </div>

      {/* Overview Tab */}
      {subTab === 'overview' && (
        <>
          {overviewQ.isError && <div className="wb-alert wb-alert--error">{formatApiError(overviewQ.error)}</div>}
          {overviewQ.isPending && <div className="wb-card" style={{ padding: 20 }}>{t('Loading monitor rollups…', '正在加载 Rollup 聚合与分析指标…')}</div>}
          {ov && (
            <>
              <div className="kpi-strip">
                <KpiCard label={t('Posts', '主帖样本')} value={ov.kpis.posts.current.toLocaleString()} detail={formatDeltaText(ov.kpis.posts, t)} />
                <KpiCard label={t('Comments', '评论数')} value={ov.kpis.comments.current.toLocaleString()} detail={formatDeltaText(ov.kpis.comments, t)} />
                <KpiCard label={t('Weighted Engagement', '加权总互动')} value={ov.kpis.totalEngagement.current.toLocaleString()} detail={formatDeltaText(ov.kpis.totalEngagement, t)} />
                <KpiCard
                  label={t('Avg ER / Depth', '平均互动率 · 讨论深度')}
                  value={ov.kpis.avgEngagementRate != null ? `${(ov.kpis.avgEngagementRate * 100).toFixed(2)}%` : 'N/A'}
                  detail={t(`Avg ${ov.kpis.discussionDepth} comments / post`, `篇均 ${ov.kpis.discussionDepth} 条评论`)}
                />
              </div>

              <div className="wb-card" style={{ padding: 14 }}>
                <strong style={{ fontSize: 13 }}>{t('Volume Timeline', '时间趋势（已存样本分桶）')}</strong>
                <MonitorTimelineSvg points={ov.timeline} />
              </div>

              <div className="wb-grid-2">
                <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
                  <strong style={{ fontSize: 13 }}>{t('Share of Voice (Keywords vs Competitors)', '声量占比 SoV（主词 vs 竞品词）')}</strong>
                  {ov.shareOfVoice.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {t('Only keyword monitors compute Share of Voice.', '仅关键词监测器产出主词/竞品词 SoV 对比，当前窗口暂无数据。')}
                    </span>
                  ) : (
                    ov.shareOfVoice.map((s) => (
                      <div key={s.label} style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>
                            <strong>{s.label}</strong>{' '}
                            <span className="tag">{s.role === 'competitor' ? t('Competitor', '竞品') : t('Primary', '主词')}</span>
                          </span>
                          <span className="tabular-nums">
                            {s.mentions} ({(s.volumeShare * 100).toFixed(1)}% · wgt {(s.weightedShare * 100).toFixed(1)}%)
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 4, background: 'var(--paper)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.max(2, (s.mentions / maxSovMentions) * 100)}%`,
                              background: s.role === 'competitor' ? '#d97706' : 'var(--accent, #2563eb)',
                            }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
                  <strong style={{ fontSize: 13 }}>{t('Intent Distribution & Co-occurring Terms', '内容意图分布与共现高频词')}</strong>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ov.intentDistribution.map((item) => (
                      <button
                        key={item.intent}
                        type="button"
                        className={`tag ${filterIntent === item.intent ? 'tag--ink' : 'tag--line'} tabular-nums`}
                        onClick={() => {
                          setPostOffset(0);
                          setFilterIntent((cur) => (cur === item.intent ? '' : item.intent));
                        }}
                      >
                        {item.intent}: {item.count}
                      </button>
                    ))}
                    {ov.intentDistribution.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('No classified intents in window.', '暂无意图分布样本。')}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ov.cooccurringTerms.slice(0, 16).map((term) => (
                      <span key={term.term} className="tag tabular-nums">{term.term} ({term.count})</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong style={{ fontSize: 13 }}>
                    <Globe size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 5 }} />
                    {t('GEO Cited External Domains (click row to filter evidence)', 'GEO 高频引用外链域名（点击下钻原帖）')}
                  </strong>
                  {filterDomain && (
                    <button type="button" className="collection-text-button" onClick={() => setFilterDomain('')}>
                      {t(`Clear domain: ${filterDomain}`, `清除域名筛选：${filterDomain}`)}
                    </button>
                  )}
                </div>
                {ov.geoCitedDomains.length === 0 ? (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('No external domain citations recorded yet.', '暂无外链引用统计。')}</span>
                ) : (
                  <table className="wb-table" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>{t('Domain', '外链域名')}</th>
                        <th>{t('Citations', '引用贴数')}</th>
                        <th>{t('Total Engagement', '累计互动')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ov.geoCitedDomains.map((d) => (
                        <tr
                          key={d.domain}
                          onClick={() => { setPostOffset(0); setFilterDomain((cur) => (cur === d.domain ? '' : d.domain)); }}
                          style={{ cursor: 'pointer', background: filterDomain === d.domain ? 'var(--paper)' : undefined }}
                        >
                          <td><code>{d.domain}</code></td>
                          <td className="tabular-nums">{d.count}</td>
                          <td className="tabular-nums">{d.totalEngagement.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Drilldown Posts */}
              <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>
                    {t('Evidence Drill-down Posts', '证据贴文下钻流')} ({postsQ.data?.totalCount ?? 0})
                  </strong>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {(filterDomain || filterIntent) && (
                      <button
                        type="button"
                        className="collection-text-button"
                        onClick={() => { setFilterDomain(''); setFilterIntent(''); setPostOffset(0); }}
                      >
                        {t('Clear active filters', '清空过滤条件')}
                      </button>
                    )}
                    <select
                      className="wb-select"
                      value={postSort}
                      onChange={(e) => { setPostOffset(0); setPostSort(e.target.value as typeof postSort); }}
                    >
                      <option value="heat">{t('Sort: Heat', '按热度')}</option>
                      <option value="score">{t('Sort: Score/Likes', '按赞数')}</option>
                      <option value="comments">{t('Sort: Comments', '按评论数')}</option>
                      <option value="views">{t('Sort: Views', '按浏览量')}</option>
                      <option value="newest">{t('Sort: Newest', '按时间')}</option>
                    </select>
                  </div>
                </div>

                {postsQ.isPending && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('Loading posts…', '正在加载证据贴文…')}</div>}
                {postsQ.data && postsQ.data.items.length === 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('No matching evidence posts in window.', '当前过滤下无匹配证据贴文。')}</div>
                )}
                {postsQ.data && postsQ.data.items.length > 0 && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {postsQ.data.items.map((p) => {
                      const href = safeHttpUrl(p.url);
                      return (
                        <div key={p.id} style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 6, display: 'grid', gap: 4 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                            {onOpenContentDetail ? (
                              <button
                                type="button"
                                onClick={() => onOpenContentDetail(p.id)}
                                style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', color: 'var(--ink)' }}
                              >
                                {p.title || p.cleanExcerpt || p.externalId}
                              </button>
                            ) : (
                              <strong style={{ fontSize: 13.5 }}>{p.title || p.cleanExcerpt || p.externalId}</strong>
                            )}
                            {href && (
                              <a href={href} target="_blank" rel="noopener noreferrer" aria-label="原文链接">
                                <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                          {p.cleanExcerpt && <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-2)' }}>{p.cleanExcerpt}</p>}
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)' }} className="tabular-nums">
                            <span>{p.platform.toUpperCase()}</span>
                            {p.authorHandle && <span>@{p.authorHandle}</span>}
                            {p.communityName && <span>r/{p.communityName}</span>}
                            {p.intentTag && <span className="tag">{p.intentTag}</span>}
                            {p.externalDomain && <span>{p.externalDomain}</span>}
                            <span>ER: {p.engagementRate?.rate != null ? `${(p.engagementRate.rate * 100).toFixed(2)}% (${p.engagementRate.basis})` : 'N/A'}</span>
                          </div>
                        </div>
                      );
                    })}
                    {(postOffset > 0 || postsQ.data.nextOffset != null) && (
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button type="button" className="ds-btn ds-btn--ghost" disabled={postOffset === 0} onClick={() => setPostOffset(Math.max(0, postOffset - 20))}>
                          {t('Prev', '上一页')}
                        </button>
                        <button type="button" className="ds-btn ds-btn--ghost" disabled={postsQ.data.nextOffset == null} onClick={() => { if (postsQ.data?.nextOffset != null) setPostOffset(postsQ.data.nextOffset); }}>
                          {t('Next', '下一页')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* KOL / Authors Tab */}
      {subTab === 'authors' && (
        <div className="wb-grid-2">
          <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Users size={14} />
              <input
                type="text"
                className="wb-input"
                style={{ maxWidth: 180 }}
                placeholder={t('Filter handle/name…', '搜索账号或昵称…')}
                value={authorSearch}
                onChange={(e) => setAuthorSearch(e.target.value)}
              />
              <select className="wb-select" value={authorPlatform} onChange={(e) => setAuthorPlatform(e.target.value as '' | 'reddit' | 'x')}>
                <option value="">{t('All platforms', '全平台')}</option>
                <option value="reddit">Reddit</option>
                <option value="x">X</option>
              </select>
              <select className="wb-select" value={authorSort} onChange={(e) => setAuthorSort(e.target.value as typeof authorSort)}>
                <option value="engagement">{t('Avg Engagement', '按平均互动')}</option>
                <option value="followers">{t('Followers', '按粉丝数')}</option>
                <option value="posts">{t('Posts', '按发帖数')}</option>
              </select>
            </div>

            {authorsQ.isPending && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('Loading authors…', '正在加载作者画像列表…')}</div>}
            {authorsQ.data && authorsQ.data.items.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('No tracked authors observed in monitor scope.', '当前监测器范围内暂无已入库作者画像。')}</div>
            )}
            {authorsQ.data && authorsQ.data.items.length > 0 && (
              <table className="wb-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>{t('Author', '作者')}</th>
                    <th>{t('Followers', '粉丝')}</th>
                    <th>{t('Posts', '帖数')}</th>
                    <th>{t('Avg Eng', '均互动')}</th>
                  </tr>
                </thead>
                <tbody>
                  {authorsQ.data.items.map((a) => {
                    const active = selectedAuthor?.handle === a.handle && selectedAuthor?.platform === a.platform;
                    return (
                      <tr
                        key={`${a.platform}:${a.handle}`}
                        onClick={() => setSelectedAuthor({ platform: a.platform as 'reddit' | 'x', handle: a.handle })}
                        style={{ cursor: 'pointer', background: active ? 'var(--paper)' : undefined }}
                      >
                        <td>
                          <strong>@{a.handle}</strong> <span className="tag">{a.platform}</span>
                          {a.verified && <span className="tag tag--ok" style={{ marginLeft: 4 }}>V</span>}
                        </td>
                        <td className="tabular-nums">{a.followersCount != null ? a.followersCount.toLocaleString() : 'N/A'}</td>
                        <td className="tabular-nums">{a.postCount}</td>
                        <td className="tabular-nums">{a.avgEngagement.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            {!selectedAuthor ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: 12 }}>
                {t('Click any author row on the left to inspect profile ER (by_views / by_followers) and representative posts.', '点击左侧任意作者行即可查看 KOL 详细画像、互动率口径与代表作。')}
              </div>
            ) : authorProfileQ.isPending ? (
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{t('Loading author profile…', '正在加载作者详情…')}</div>
            ) : authorProfileQ.error ? (
              <div className="wb-alert wb-alert--error">{formatApiError(authorProfileQ.error)}</div>
            ) : authorProfileQ.data && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{authorProfileQ.data.profile.displayName || `@${authorProfileQ.data.profile.handle}`}</strong>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      @{authorProfileQ.data.profile.handle} · {authorProfileQ.data.profile.platform}
                    </div>
                  </div>
                  <div className="tag tag--ink tabular-nums">
                    ER: {authorProfileQ.data.er.rate != null ? `${(authorProfileQ.data.er.rate * 100).toFixed(2)}%` : 'N/A'} ({authorProfileQ.data.er.basis})
                  </div>
                </div>
                {authorProfileQ.data.profile.bio && (
                  <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{authorProfileQ.data.profile.bio}</p>
                )}
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--muted)' }} className="tabular-nums">
                  <span>{t('Followers', '粉丝')}: {authorProfileQ.data.profile.followersCount != null ? authorProfileQ.data.profile.followersCount.toLocaleString() : 'N/A'}</span>
                  <span>{t('Views', '总浏览')}: {authorProfileQ.data.profile.totalViews.toLocaleString()}</span>
                  <span>{t('Comments', '总评论')}: {authorProfileQ.data.profile.totalComments.toLocaleString()}</span>
                </div>
                <strong style={{ fontSize: 12.5 }}>{t('Top Representative Posts', '代表高热贴文')}</strong>
                <div style={{ display: 'grid', gap: 6 }}>
                  {authorProfileQ.data.topPosts.slice(0, 8).map((p) => (
                    <div key={p.id} style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}>
                      {onOpenContentDetail ? (
                        <button type="button" onClick={() => onOpenContentDetail(p.id)} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }}>
                          {p.title || p.cleanExcerpt || p.externalId}
                        </button>
                      ) : (
                        <strong>{p.title || p.cleanExcerpt || p.externalId}</strong>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Subreddit Matrix Tab */}
      {subTab === 'communities' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="wb-grid-2">
            <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
              <strong style={{ fontSize: 13 }}>{t('Subreddit Quadrant (Volume vs Avg Discussion Depth)', 'Subreddit 对比象限（发帖量 vs 篇均评论深度）')}</strong>
              {communitiesQ.isPending ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('Loading matrix…', '加载矩阵中…')}</div>
              ) : (
                <SubredditQuadrantSvg
                  items={communitiesQ.data?.items ?? []}
                  selected={activeCommunity ?? null}
                  onSelect={(sub) => setSelectedSubreddit(sub)}
                />
              )}
            </div>

            <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
              <strong style={{ fontSize: 13 }}>{t('Monitored Communities', '已观测板块列表')}</strong>
              {communitiesQ.data && communitiesQ.data.items.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('No Reddit community samples yet.', '当前范围内暂无 Reddit 板块样本。')}</div>
              )}
              {communitiesQ.data && communitiesQ.data.items.length > 0 && (
                <table className="wb-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Subreddit</th>
                      <th>{t('Posts', '帖数')}</th>
                      <th>{t('Avg Comments', '均评论')}</th>
                      <th>{t('P90 Eng', 'P90 热度')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {communitiesQ.data.items.map((c) => (
                      <tr
                        key={c.subreddit}
                        onClick={() => setSelectedSubreddit(c.subreddit)}
                        style={{ cursor: 'pointer', background: activeCommunity === c.subreddit ? 'var(--paper)' : undefined }}
                      >
                        <td><strong>r/{c.subreddit}</strong></td>
                        <td className="tabular-nums">{c.postCount}</td>
                        <td className="tabular-nums">{c.avgComments}</td>
                        <td className="tabular-nums">{c.p90Engagement.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {activeCommunity && communityDeepQ.data && (
            <div className="wb-card" style={{ padding: 14, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <strong style={{ fontSize: 14 }}>r/{communityDeepQ.data.subreddit} — {t('Deep Dive', '深度切片')}</strong>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {communityDeepQ.data.flairs.slice(0, 8).map((f) => (
                    <span key={f.flair} className="tag tabular-nums">{f.flair}: {f.count}</span>
                  ))}
                </div>
              </div>
              <PostingHeatmapGrid cells={communityDeepQ.data.postingHeatmap} />
              <div style={{ display: 'grid', gap: 6 }}>
                <strong style={{ fontSize: 12.5 }}>{t('High-discussion community posts', '高频互动代表贴文')}</strong>
                {communityDeepQ.data.topPosts.slice(0, 6).map((p) => (
                  <div key={p.id} style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}>
                    {onOpenContentDetail ? (
                      <button type="button" onClick={() => onOpenContentDetail(p.id)} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', fontWeight: 600, cursor: 'pointer', color: 'var(--ink)' }}>
                        {p.title || p.cleanExcerpt || p.externalId}
                      </button>
                    ) : (
                      <strong>{p.title || p.cleanExcerpt || p.externalId}</strong>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--muted)' }} className="tabular-nums">
                      Score: {p.metricScore ?? 0} · Comments: {p.metricComments ?? 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
