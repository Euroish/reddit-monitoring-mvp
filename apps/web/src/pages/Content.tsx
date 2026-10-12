import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Button, Input, Select } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { CollectionSource, CollectionSourceResponse, ContentListResponse, ContentStatsResponse, PublicContentKind, SourceJobResponse, SourceListResponse } from '../../../../packages/contracts/src/http';
import './Content.css';

export function Content() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const copy = (en: string, cn: string) => zh ? cn : en;
  const canCollect = user?.role === 'owner' || user?.role === 'admin';
  const client = useQueryClient();
  const [scopeType, setScopeType] = useState<'community' | 'account' | 'post'>('community');
  const [scopeName, setScopeName] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [collectKind, setCollectKind] = useState<'post' | 'comment'>('post');
  const [keyword, setKeyword] = useState('');
  const [selectedSource, setSelectedSource] = useState('');
  const [kind, setKind] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState('');
  const [cursor, setCursor] = useState('');
  const [previous, setPrevious] = useState<string[]>([]);
  const jobStorageKey = `source-content-job:${user?.id ?? 'session'}`;
  const [jobId, setJobId] = useState(() => sessionStorage.getItem(jobStorageKey) ?? '');
  const rememberJob = (id: string) => { sessionStorage.setItem(jobStorageKey, id); setJobId(id); };
  const sources = useQuery({ queryKey: ['contentSources'], queryFn: () => fetchApi<SourceListResponse>('/v1/sources'), retry: false });
  const list = useQuery({ queryKey: ['sourceContent', filters, cursor], queryFn: () => fetchApi<ContentListResponse>(`/v1/content?limit=25&${filters}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), retry: false });
  const stats = useQuery({ queryKey: ['sourceContentStats', filters], queryFn: () => fetchApi<ContentStatsResponse>(`/v1/content/stats?${filters}`), retry: false });
  const job = useQuery({ queryKey: ['sourceContentJob', jobId], queryFn: () => fetchApi<SourceJobResponse>(`/v1/source-jobs/${jobId}`), enabled: Boolean(jobId), retry: false, refetchInterval: query => ['queued', 'running', 'retrying'].includes(query.state.data?.job.status ?? '') ? 3000 : false });
  useEffect(() => {
    if (job.data?.job.status === 'succeeded' || job.data?.job.status === 'failed') {
      void client.invalidateQueries({ queryKey: ['sourceContent'] });
      void client.invalidateQueries({ queryKey: ['sourceContentStats'] });
      void client.invalidateQueries({ queryKey: ['contentSources'] });
    }
  }, [job.data?.job.status, job.data?.job.id, client]);
  const createSource = useMutation({
    mutationFn: () => fetchApi<CollectionSourceResponse>('/v1/sources', { method: 'POST', body: JSON.stringify({ platform: 'reddit', provider: 'arctic_shift', contentKind: collectKind, target: { type: scopeType, ...(scopeType === 'community' ? { community: scopeName } : scopeType === 'account' ? { account: scopeName } : { postId: scopeName }), ...(sourceQuery.trim() ? { query: sourceQuery.trim() } : {}) } }) }),
    onSuccess: data => { setSelectedSource(data.source.id); void client.invalidateQueries({ queryKey: ['contentSources'] }); },
  });
  const collect = useMutation({
    mutationFn: (sourceId: string) => fetchApi<SourceJobResponse>(`/v1/sources/${sourceId}/collect`, { method: 'POST', body: JSON.stringify({ ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}), maxPages: 5, pageSize: 25 }) }),
    onSuccess: data => rememberJob(data.job.id),
  });
  const resume = useMutation({ mutationFn: (action: 'retry' | 'continue') => fetchApi<SourceJobResponse>(`/v1/source-jobs/${jobId}/${action}`, { method: 'POST', body: '{}' }), onSuccess: data => { rememberJob(data.job.id); void client.invalidateQueries({ queryKey: ['sourceContentJob'] }); } });
  const search = (event: FormEvent) => {
    event.preventDefault(); const params = new URLSearchParams();
    if (keyword.trim()) params.set('query', keyword.trim());
    if (selectedSource) params.set('sourceId', selectedSource);
    if (kind) params.set('kind', kind);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    setFilters(params.toString()); setCursor(''); setPrevious([]);
    void client.invalidateQueries({ queryKey: ['sourceContent'] }); void client.invalidateQueries({ queryKey: ['sourceContentStats'] });
  };
  const time = (value: string | null) => value ? new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US') : copy('Unknown', '未知');
  const kindLabel = (value: PublicContentKind) => ({ post: copy('Post', '帖子'), comment: copy('Comment', '评论'), article: copy('Article', '文章'), image: copy('Image', '图片'), video: copy('Video', '视频') })[value];
  const sourceName = (source: CollectionSource) => `${source.label} · ${source.provider}`;
  const supported = (source: CollectionSource) => sources.data?.capabilities.some(capability => capability.enabled && capability.platform === source.platform && capability.provider === source.provider && capability.contentKinds.includes(source.contentKind));
  const metricLabel = (key: string) => ({ 'reddit.score': copy('Score', '分数'), 'reddit.num_comments': copy('Comments', '评论数'), 'reddit.upvote_ratio': copy('Upvote ratio', '赞同比例') } as Record<string, string>)[key] ?? key;
  const currentJob = job.data?.job;
  const activeJob = Boolean(currentJob && ['queued', 'running', 'retrying'].includes(currentJob.status));
  const failure = sources.error ?? list.error ?? stats.error ?? job.error ?? createSource.error ?? collect.error ?? resume.error;
  return (
    <div className="source-content-page">
      <header className="content-heading"><h1>{copy('Collected content', '来源内容查询')}</h1><p>{copy('Search saved posts and comments. Collect a source to add new results.', '查询已保存的帖子与评论，采集来源后可查看新增内容。')}</p></header>
      {failure && <p role="alert" className="content-error">{failure.message} <Button onClick={() => { void sources.refetch(); void list.refetch(); void stats.refetch(); }}>{copy('Refresh results', '刷新结果')}</Button></p>}
      <section aria-labelledby="sources-title" className="content-source-section">
        <h2 id="sources-title">{copy('Sources', '数据来源')}</h2>
        <p className="content-muted">Reddit · Arctic Shift · {copy('Content archive. Initial metrics may update around 36 hours later.', '内容归档。初次归档的互动指标可能在约 36 小时后更新。')}</p>
        <details className="content-source-disclosure" open={sources.data?.sources.length === 0}><summary>{canCollect ? copy('View and manage sources', '查看与管理来源') : copy('View sources', '查看来源')} ({sources.data?.sources.length ?? 0})</summary>
        {sources.isLoading && <p role="status">{copy('Loading sources…', '正在加载来源…')}</p>}
        {sources.data?.sources.length === 0 && <p>{copy('No sources yet.', '尚未添加来源。')}{!canCollect && copy('Ask an administrator to add a source.', '请联系管理员添加来源。')}</p>}
        <ul className="content-source-list">{sources.data?.sources.map(source => <li key={source.id}>
          <div><strong>{sourceName(source)}</strong><span className="content-muted">{kindLabel(source.contentKind)} · {copy('Last collection', '最近采集')} {time(source.lastSuccessAt)}{source.lastSuccessAt && sources.dataUpdatedAt - Date.parse(source.lastSuccessAt) > 43200000 ? ` · ${copy('Collection is over 12 hours old', '采集已超过 12 小时')}` : ''}<br />{copy('Latest saved publication', '已存最新发布时间')} {time(source.latestPublishedAt)} · {copy('Coverage', '覆盖范围')}: {source.coverage === 'partial' ? copy('Partial', '部分') : copy('Unknown', '未知')}</span></div>
          {canCollect && <Button onClick={() => collect.mutate(source.id)} disabled={!supported(source) || collect.isPending || activeJob && currentJob?.sourceId === source.id}>{supported(source) ? copy('Collect', '采集') : copy('Collection unavailable', '采集尚未接入')}</Button>}
        </li>)}</ul>
        {canCollect && <details className="content-source-create"><summary>{copy('Add a Reddit source', '添加 Reddit 来源')}</summary><form onSubmit={event => { event.preventDefault(); createSource.mutate(); }} className="content-fields">
          <label htmlFor="source-target-type">{copy('Target type', '目标类型')}<Select id="source-target-type" value={scopeType} onChange={event => { const next = event.target.value as typeof scopeType; setScopeType(next); if (next === 'post') setCollectKind('comment'); }}><option value="community">{copy('Community', '社区')}</option><option value="account">{copy('Account', '账号')}</option><option value="post">{copy('Post comments', '帖子评论')}</option></Select></label>
          <label htmlFor="source-target">{copy('Community / account / post ID', '社区 / 账号 / 帖子 ID')}<Input id="source-target" value={scopeName} onChange={event => setScopeName(event.target.value)} required maxLength={40} placeholder={scopeType === 'community' ? 'technology' : scopeType === 'account' ? 'username' : 'post ID'} /></label>
          <label htmlFor="source-kind">{copy('Content type', '内容类型')}<Select id="source-kind" value={collectKind} onChange={event => setCollectKind(event.target.value as typeof collectKind)}><option value="post" disabled={scopeType === 'post'}>{copy('Posts', '帖子')}</option><option value="comment">{copy('Comments', '评论')}</option></Select></label>
          <label htmlFor="source-keyword">{copy('Collection keyword (optional)', '采集关键词（可选）')}<Input id="source-keyword" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} maxLength={200} /></label>
          <Button type="submit" variant="primary" disabled={createSource.isPending}>{copy('Save source', '保存来源')}</Button>
        </form></details>}
        </details>
        {currentJob && <div role="status" className="content-job"><strong>{copy('Collection', '采集任务')}: {copy(currentJob.status, ({ queued: '等待采集', running: '正在采集', retrying: '稍后重试', succeeded: '采集结束', failed: '采集失败' })[currentJob.status])}</strong><span>{copy('Pages saved', '已保存页数')} {currentJob.pagesCommitted} · {copy('Records processed', '已处理条数')} {currentJob.recordsProcessed} · {currentJob.coverage === 'partial' ? copy('Partial coverage', '部分覆盖') : copy('Coverage unknown', '覆盖未知')}</span>
          {currentJob.error && <span className="content-error">{currentJob.error}</span>}
          {currentJob.status === 'failed' && canCollect && <Button onClick={() => resume.mutate('retry')} disabled={resume.isPending}>{copy('Retry collection', '重试采集')}</Button>}
          {currentJob.status === 'succeeded' && currentJob.checkpoint !== null && canCollect && <Button onClick={() => resume.mutate('continue')} disabled={resume.isPending}>{copy('Collect next pages', '继续采集后续页')}</Button>}
        </div>}
      </section>
      <section aria-labelledby="query-title"><h2 id="query-title">{copy('Search saved content', '查询已存内容')}</h2>
        <form onSubmit={search} className="content-fields">
          <label htmlFor="content-keyword">{copy('Keyword', '关键词')}<Input id="content-keyword" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={200} placeholder={copy('Match title or text', '匹配标题或正文')} /></label>
          <label htmlFor="content-source">{copy('Source', '来源')}<Select id="content-source" value={selectedSource} onChange={event => setSelectedSource(event.target.value)}><option value="">{copy('All collected sources', '所有已采集来源')}</option>{sources.data?.sources.map(source => <option key={source.id} value={source.id}>{sourceName(source)}</option>)}</Select></label>
          <label htmlFor="content-kind">{copy('Content type', '内容类型')}<Select id="content-kind" value={kind} onChange={event => setKind(event.target.value)}><option value="">{copy('All types', '全部类型')}</option>{[...new Set(sources.data?.capabilities.flatMap(item => item.contentKinds) ?? ['post', 'comment'])].map(value => <option key={value} value={value}>{kindLabel(value as PublicContentKind)}</option>)}</Select></label>
          <label htmlFor="content-from">{copy('Published from', '发布时间起点')}<Input id="content-from" type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label htmlFor="content-to">{copy('Published before', '发布时间终点')}<Input id="content-to" type="datetime-local" value={to} onChange={event => setTo(event.target.value)} /></label>
          <Button type="submit" variant="primary" disabled={list.isFetching}>{copy('Search', '查询')}</Button>
        </form>
        <p className="content-muted">{copy('Collection uses the search time window, or the last 24 hours when dates are empty. Search only reads saved results.', '采集使用查询区的时间范围；日期留空时取最近 24 小时。查询只读取已保存结果。')}</p>
        {stats.data && <p className="content-summary">{copy('Saved matches', '已存匹配内容')} <strong>{stats.data.total}</strong> · {stats.data.byKind.map(item => `${kindLabel(item.kind)} ${item.count}`).join(' · ')} <span className="content-muted">{copy('Counts cover the saved sample, not all platform activity.', '统计范围为已存样本，不代表平台全量。')}</span></p>}
        {stats.data && stats.data.daily.length > 0 && <details><summary>{copy('Daily saved counts (UTC)', '每日已存内容数（UTC）')}</summary><ol className="content-daily">{stats.data.daily.map(day => <li key={day.day}><span>{day.day}</span><strong>{day.count}</strong></li>)}</ol></details>}
        {list.isLoading && <p role="status">{copy('Loading content…', '正在加载内容…')}</p>}
        {list.data?.items.length === 0 && <p className="content-empty">{copy('No saved content matches. Change the filters or collect a source.', '没有匹配的已存内容。可调整筛选条件，或先采集来源。')}</p>}
        <div className="content-results">{list.data?.items.map(item => <article key={item.id} className="content-result">
          <div className="content-meta"><span>{item.platform} · {kindLabel(item.kind)}</span><span>{item.author?.handle ?? copy('Author unavailable', '作者未知')}</span><span>{copy('Published', '发布')} {time(item.publishedAt)}</span></div>
          <h3>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || (item.kind === 'comment' ? copy('View comment', '查看评论') : copy('View source content', '查看原始内容'))}</a> : item.title || kindLabel(item.kind)}</h3>
          {item.text && <p className="content-text">{item.text.slice(0, 800)}{item.text.length > 800 ? '…' : ''}</p>}
          {item.availability === 'removed' || item.availability === 'deleted' ? <p>{copy('Content removed or deleted at the source.', '源内容已移除或删除。')}</p> : null}
          {item.references.length > 0 && <p className="content-muted">{item.references.map(ref => `${ref.relation}: ${ref.externalId}`).join(' · ')}</p>}
          <div className="content-observations">{item.observations.map(obs => <div key={obs.sourceId}>
            <span><strong>{obs.provider}</strong> · {obs.timeBasis === 'archive_refresh' ? copy('Archive refreshed', '已二次归档') : obs.timeBasis === 'archive_initial' ? copy('Initial archive; metrics pending refresh', '初次归档；指标待更新') : obs.timeBasis === 'provider_snapshot' ? copy('Provider snapshot', '来源快照') : copy('Observation time unknown', '观测时间未知')}</span>
            <span className="content-muted">{obs.timeBasis.startsWith('archive_') ? copy('Source archive time', '源归档时间') : copy('Source observation time', '源观测时间')} {time(obs.sourceObservedAt)} · {copy('Fetched', '取回')} {time(obs.fetchedAt)}</span>
            <span>{Object.entries(obs.metrics).map(([key, value]) => `${metricLabel(key)}: ${value === null ? '—' : key === 'reddit.upvote_ratio' ? `${(value * 100).toFixed(1)}%` : value}`).join(' · ')}</span>
          </div>)}</div>
        </article>)}</div>
        <div className="content-pager"><Button disabled={previous.length === 0 || list.isFetching} onClick={() => { setCursor(previous.at(-1) ?? ''); setPrevious(previous.slice(0, -1)); }}>{copy('Previous', '上一页')}</Button><span>{copy('Page', '第')} {previous.length + 1}{zh ? ' 页' : ''}</span><Button disabled={!list.data?.nextCursor || list.isFetching} onClick={() => { setPrevious([...previous, cursor]); setCursor(list.data?.nextCursor ?? ''); }}>{copy('Next', '下一页')}</Button></div>
      </section>
    </div>
  );
}
