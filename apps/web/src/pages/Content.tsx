import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Button, Input, Select } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { CollectionSource, CollectionSourceResponse, ContentListResponse, ContentWorkbenchResponse, PublicContentKind, SourceJobResponse, SourceListResponse, SourceTarget } from '../../../../packages/contracts/src/http';
import { SourceSettings } from '../features/content/SourceSettings';
import { SourceTasks } from '../features/content/SourceTasks';
import { SourceOperations } from '../features/content/SourceOperations';
import { ContentExport } from '../features/content/ContentExport';
import './Content.css';

export function Content() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const copy = (en: string, cn: string) => zh ? cn : en;
  const canCollect = user?.role === 'owner' || user?.role === 'admin';
  const client = useQueryClient();
  const [providerKey, setProviderKey] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [scopeType, setScopeType] = useState<SourceTarget['type']>('community');
  const [scopeName, setScopeName] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [collectKind, setCollectKind] = useState<PublicContentKind>('post');
  const [platformFilter, setPlatformFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
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
  const capabilities = sources.data?.capabilities ?? [];
  const creationCapability = capabilities.find(item => `${item.platform}:${item.provider}` === providerKey)
    ?? capabilities.find(item => item.enabled) ?? capabilities[0];
  const targetType = creationCapability?.targetTypes.includes(scopeType) ? scopeType : creationCapability?.targetTypes[0] ?? 'community';
  const contentKind = targetType === 'post' && creationCapability?.platform === 'reddit' ? 'comment'
    : creationCapability?.contentKinds.includes(collectKind) ? collectKind : creationCapability?.contentKinds[0] ?? 'post';
  const list = useQuery({ queryKey: ['sourceContent', filters, cursor], queryFn: () => fetchApi<ContentListResponse>(`/v1/content?limit=25&${filters}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`), retry: false });
  const workbench = useQuery({ queryKey: ['sourceContentWorkbench', filters], queryFn: () => fetchApi<ContentWorkbenchResponse>(`/v1/content/workbench?${filters}`), retry: false });
  const stats = workbench.data?.stats;
  const job = useQuery({ queryKey: ['sourceContentJob', jobId], queryFn: () => fetchApi<SourceJobResponse>(`/v1/source-jobs/${jobId}`), enabled: Boolean(jobId), retry: false, refetchInterval: query => ['queued', 'running', 'retrying'].includes(query.state.data?.job.status ?? '') ? 3000 : false });
  useEffect(() => {
    if (job.data?.job.status === 'succeeded' || job.data?.job.status === 'failed' || job.data?.job.status === 'cancelled') {
      void client.invalidateQueries({ queryKey: ['sourceContent'] });
      void client.invalidateQueries({ queryKey: ['sourceContentWorkbench'] });
      void client.invalidateQueries({ queryKey: ['contentSources'] });
      void client.invalidateQueries({ queryKey: ['sourceJobs'] });
      void client.invalidateQueries({ queryKey: ['sourceOps'] });
    }
  }, [job.data?.job.status, job.data?.job.id, client]);
  const createSource = useMutation({
    mutationFn: () => {
      if (!creationCapability?.enabled) throw new Error(copy('This provider is not enabled. Configure it locally first.', '该 provider 尚未启用，请先完成本地配置。'));
      const target: SourceTarget = targetType === 'search' ? { type: 'search', query: sourceQuery.trim() }
        : targetType === 'feed' ? { type: 'feed', url: scopeName.trim() }
        : { type: targetType, ...(targetType === 'community' ? { community: scopeName } : targetType === 'account' ? { account: scopeName } : { postId: scopeName }), ...(sourceQuery.trim() && creationCapability.keywordSearch !== 'none' ? { query: sourceQuery.trim() } : {}) } as SourceTarget;
      return fetchApi<CollectionSourceResponse>('/v1/sources', { method: 'POST', body: JSON.stringify({ platform: creationCapability.platform, provider: creationCapability.provider, label: sourceLabel.trim() || undefined, contentKind, target }) });
    },
    onSuccess: data => { setSelectedSource(data.source.id); void client.invalidateQueries({ queryKey: ['contentSources'] }); },
  });
  const collect = useMutation({
    mutationFn: (sourceId: string) => fetchApi<SourceJobResponse>(`/v1/sources/${sourceId}/collect`, { method: 'POST', body: JSON.stringify({ ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}), maxPages: 5, pageSize: 25 }) }),
    onSuccess: data => { rememberJob(data.job.id); void client.invalidateQueries({ queryKey: ['sourceJobs'] }); void client.invalidateQueries({ queryKey: ['sourceOps'] }); },
  });
  const resume = useMutation({ mutationFn: (action: 'retry' | 'continue' | 'cancel') => fetchApi<SourceJobResponse>(`/v1/source-jobs/${jobId}/${action}`, { method: 'POST', body: '{}' }), onSuccess: data => { rememberJob(data.job.id); void client.invalidateQueries({ queryKey: ['sourceContentJob'] }); void client.invalidateQueries({ queryKey: ['sourceJobs'] }); void client.invalidateQueries({ queryKey: ['sourceOps'] }); } });
  const sourceState = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'archive' }) => fetchApi<CollectionSourceResponse>(`/v1/sources/${id}/${action}`, { method: 'POST', body: '{}' }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['contentSources'] }); void client.invalidateQueries({ queryKey: ['sourceJobs'] }); void client.invalidateQueries({ queryKey: ['sourceOps'] }); } });
  const search = (event: FormEvent) => {
    event.preventDefault(); const params = new URLSearchParams();
    if (keyword.trim()) params.set('query', keyword.trim());
    if (selectedSource) params.set('sourceId', selectedSource);
    if (platformFilter) params.set('platform', platformFilter);
    if (providerFilter) params.set('provider', providerFilter);
    if (kind) params.set('kind', kind);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    setFilters(params.toString()); setCursor(''); setPrevious([]);
    void client.invalidateQueries({ queryKey: ['sourceContent'] }); void client.invalidateQueries({ queryKey: ['sourceContentWorkbench'] });
  };
  const time = (value: string | null) => value ? new Date(value).toLocaleString(zh ? 'zh-CN' : 'en-US') : copy('Unknown', '未知');
  const kindLabel = (value: PublicContentKind) => ({ post: copy('Post', '帖子'), comment: copy('Comment', '评论'), article: copy('Article', '文章'), image: copy('Image', '图片'), video: copy('Video', '视频') })[value];
  const sourceName = (source: CollectionSource) => `${source.label} · ${source.provider}`;
  const supported = (source: CollectionSource) => sources.data?.capabilities.some(capability => capability.enabled && capability.platform === source.platform && capability.provider === source.provider && capability.contentKinds.includes(source.contentKind));
  const metricLabel = (key: string) => ({ 'reddit.score': copy('Score', '分数'), 'reddit.num_comments': copy('Comments', '评论数'), 'reddit.upvote_ratio': copy('Upvote ratio', '赞同比例') } as Record<string, string>)[key] ?? capabilities.flatMap(item => item.metrics).find(metric => metric.key === key)?.label ?? key;
  const isDemo = (provider: string) => provider.startsWith('demo_');
  const targetLabel = (type: SourceTarget['type']) => ({ community: copy('Community', '社区'), account: copy('Account', '账号'), post: copy('Post comments', '帖子评论'), search: copy('Search expression', '搜索表达式'), feed: copy('Feed URL', 'Feed 地址') })[type];
  const stateLabel = (state: CollectionSource['state']) => ({ active: copy('Active', '启用'), paused: copy('Paused', '暂停'), archived: copy('Archived', '归档') })[state];
  const targetDescription = (target: SourceTarget) => target.type === 'search' ? target.query : target.type === 'feed' ? target.url
    : `${target.type === 'community' ? target.community : target.type === 'account' ? target.account : target.postId}${target.query ? ` · ${target.query}` : ''}`;
  const currentJob = job.data?.job;
  const currentJobSource = sources.data?.sources.find(source => source.id === currentJob?.sourceId);
  const canResumeJob = canCollect && currentJobSource?.state === 'active' && supported(currentJobSource);
  const activeJob = Boolean(currentJob && ['queued', 'running', 'retrying'].includes(currentJob.status));
  const failure = sources.error ?? list.error ?? workbench.error ?? job.error ?? createSource.error ?? collect.error ?? resume.error ?? sourceState.error;
  return (
    <div className="source-content-page">
      <header className="content-heading"><h1>{copy('Collected content', '来源内容查询')}</h1><p>{copy('Search saved content across sources. Manage collection, tasks and budgets without changing the source identity.', '跨来源查询已存内容，并管理采集计划、任务和预算。')}</p></header>
      {failure && <p role="alert" className="content-error">{failure.message} <Button onClick={() => { void sources.refetch(); void list.refetch(); void workbench.refetch(); }}>{copy('Refresh results', '刷新结果')}</Button></p>}
      <section aria-labelledby="sources-title" className="content-source-section">
        <h2 id="sources-title">{copy('Sources', '数据来源')}</h2>
        <p className="content-muted">{copy('Provider availability follows local configuration. Demo providers generate synthetic data and never represent live platform coverage.', 'Provider 可用性以本地配置为准；Demo provider 生成合成数据，不代表真实平台内容或覆盖。')}</p>
        <details className="content-source-disclosure" open={sources.data?.sources.length === 0}><summary>{canCollect ? copy('View and manage sources', '查看与管理来源') : copy('View sources', '查看来源')} ({sources.data?.sources.length ?? 0})</summary>
        {sources.isLoading && <p role="status">{copy('Loading sources…', '正在加载来源…')}</p>}
        {sources.data?.sources.length === 0 && <p>{copy('No sources yet.', '尚未添加来源。')}{!canCollect && copy('Ask an administrator to add a source.', '请联系管理员添加来源。')}</p>}
        <ul className="content-source-list">{sources.data?.sources.map(source => <li key={source.id}>
          <div style={{ width: '100%' }}><strong>{sourceName(source)} · {stateLabel(source.state)}{isDemo(source.provider) ? ` · ${copy('SYNTHETIC DEMO', '合成演示')}` : ''}</strong><span className="content-muted">{source.platform} · {kindLabel(source.contentKind)} · {targetLabel(source.target.type)}: {targetDescription(source.target)}{source.group ? ` · ${source.group}` : ''}<br />{copy('Last collection', '最近采集')} {time(source.lastSuccessAt)}{source.lastSuccessAt && sources.dataUpdatedAt - Date.parse(source.lastSuccessAt) > 43200000 ? ` · ${copy('Collection is over 12 hours old', '采集已超过 12 小时')}` : ''}<br />{copy('Latest saved publication', '已存最新发布时间')} {time(source.latestPublishedAt)} · {copy('Coverage', '覆盖范围')}: {source.coverage === 'partial' ? copy('Partial', '部分') : copy('Unknown', '未知')}<br />{copy('Next scheduled window', '下次调度')} {time(source.nextDueAt)} · {copy('Incremental checkpoint', '增量检查点')} {time(source.incrementalTo)}</span>
          {canCollect && <><div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            <Button onClick={() => collect.mutate(source.id)} disabled={source.state !== 'active' || !supported(source) || collect.isPending || activeJob && currentJob?.sourceId === source.id}>{supported(source) ? copy('Collect', '采集') : copy('Collection unavailable', '采集尚未接入')}</Button>
            {source.state === 'active' ? <Button disabled={sourceState.isPending} onClick={() => sourceState.mutate({ id: source.id, action: 'pause' })}>{copy('Pause source', '暂停来源')}</Button> : <Button disabled={sourceState.isPending} onClick={() => sourceState.mutate({ id: source.id, action: 'resume' })}>{copy('Resume source', '恢复来源')}</Button>}
            {source.state !== 'archived' && <Button disabled={sourceState.isPending} onClick={() => sourceState.mutate({ id: source.id, action: 'archive' })}>{copy('Archive source', '归档来源')}</Button>}
          </div><SourceSettings source={source} capability={capabilities.find(item => item.platform === source.platform && item.provider === source.provider)} zh={zh} onUpdated={() => { void client.invalidateQueries({ queryKey: ['contentSources'] }); void client.invalidateQueries({ queryKey: ['sourceOps'] }); }} /></>}
          </div>
        </li>)}</ul>
        {canCollect && <details className="content-source-create"><summary>{copy('Add a source', '添加来源')}</summary><form onSubmit={event => { event.preventDefault(); createSource.mutate(); }} className="content-fields">
          <label htmlFor="source-provider">{copy('Platform / provider', '平台 / provider')}<Select aria-label={copy('Platform / provider', '平台 / provider')} id="source-provider" value={creationCapability ? `${creationCapability.platform}:${creationCapability.provider}` : ''} onChange={event => { setProviderKey(event.target.value); setScopeName(''); setSourceQuery(''); createSource.reset(); }}>{capabilities.map(item => <option key={`${item.platform}:${item.provider}`} value={`${item.platform}:${item.provider}`}>{item.platform} · {item.provider}{isDemo(item.provider) ? copy(' (synthetic demo)', '（合成演示）') : ''}{!item.enabled ? copy(' (disabled)', '（未启用）') : ''}</option>)}</Select></label>
          <label htmlFor="source-label">{copy('Source label (optional)', '来源名称（可选）')}<Input id="source-label" value={sourceLabel} onChange={event => setSourceLabel(event.target.value)} maxLength={100} /></label>
          <label htmlFor="source-target-type">{copy('Target type', '目标类型')}<Select aria-label={copy('Target type', '目标类型')} id="source-target-type" value={targetType} onChange={event => setScopeType(event.target.value as SourceTarget['type'])}>{creationCapability?.targetTypes.map(type => <option key={type} value={type}>{targetLabel(type)}</option>)}</Select></label>
          {targetType !== 'search' && <label htmlFor="source-target">{targetLabel(targetType)}<Input id="source-target" value={scopeName} onChange={event => setScopeName(event.target.value)} required maxLength={targetType === 'feed' ? 2000 : 100} placeholder={targetType === 'community' ? 'technology' : targetType === 'account' ? 'username' : targetType === 'feed' ? 'https://…' : 'post ID'} /></label>}
          <label htmlFor="source-kind">{copy('Content type', '内容类型')}<Select aria-label={copy('Collection content type', '采集内容类型')} id="source-kind" value={contentKind} onChange={event => setCollectKind(event.target.value as PublicContentKind)}>{creationCapability?.contentKinds.map(value => <option key={value} value={value} disabled={targetType === 'post' && creationCapability.platform === 'reddit' && value !== 'comment'}>{kindLabel(value)}</option>)}</Select></label>
          {creationCapability?.keywordSearch !== 'none' && <label htmlFor="source-keyword">{targetType === 'search' ? copy('Search expression', '搜索表达式') : copy('Collection keyword (optional)', '采集关键词（可选）')}<Input id="source-keyword" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} required={targetType === 'search'} maxLength={200} /></label>}
          <Button type="submit" variant="primary" disabled={createSource.isPending || !creationCapability?.enabled}>{copy('Save source', '保存来源')}</Button>
        </form>{creationCapability && <p className="content-muted">{isDemo(creationCapability.provider) && <strong>{copy('SYNTHETIC DEMO. ', '合成演示。')}</strong>}{!creationCapability.enabled && copy('Collection is disabled until its local credentials and network settings are ready. ', '本地凭证与网络配置准备完成前不可采集。')}{creationCapability.limitations.join(' ')}</p>}</details>}
        </details>
        {currentJob && <div role="status" className="content-job"><strong>{copy('Collection', '采集任务')}: {copy(currentJob.status, ({ queued: '等待采集', running: '正在采集', retrying: '稍后重试', succeeded: '采集结束', failed: '采集失败', cancelled: '已取消' })[currentJob.status])}</strong><span>{copy('Pages saved', '已保存页数')} {currentJob.pagesCommitted} · {copy('Records processed', '已处理条数')} {currentJob.recordsProcessed} · {currentJob.coverage === 'partial' ? copy('Partial coverage', '部分覆盖') : copy('Coverage unknown', '覆盖未知')}</span>
          <span>{copy('Registered requests', '已登记请求')} {currentJob.requestCount ?? '—'} · {copy('Cumulative fetch/parse time (ms)', '累计取页耗时(ms)')} {currentJob.requestDurationMs ?? '—'}</span>
          <span className="content-muted">{copy('Cancelled requests or lost worker leases may not be registered. This is not a provider bill; budget reservations are separate.', '取消请求或丢失 worker 租约时可能未成功登记，不能当作数据商账单；预算预留另行统计。')}</span>
          {currentJob.error && <span className="content-error">{currentJob.error}</span>}
          {currentJob.status === 'failed' && canResumeJob && <Button onClick={() => resume.mutate('retry')} disabled={resume.isPending}>{copy('Retry collection', '重试采集')}</Button>}
          {currentJob.status === 'succeeded' && currentJob.checkpoint !== null && canResumeJob && <Button onClick={() => resume.mutate('continue')} disabled={resume.isPending}>{copy('Collect next pages', '继续采集后续页')}</Button>}
          {activeJob && canCollect && <Button onClick={() => resume.mutate('cancel')} disabled={resume.isPending}>{copy('Cancel collection', '取消采集')}</Button>}
        </div>}
        <SourceTasks sources={sources.data?.sources ?? []} canEdit={canCollect} zh={zh} onJob={rememberJob} />
        <SourceOperations canEdit={canCollect} zh={zh} />
      </section>
      <section aria-labelledby="query-title"><h2 id="query-title">{copy('Search saved content', '查询已存内容')}</h2>
        <form onSubmit={search} className="content-fields">
          <label htmlFor="content-keyword">{copy('Keyword', '关键词')}<Input id="content-keyword" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={200} placeholder={copy('Match title or text', '匹配标题或正文')} /></label>
          <label htmlFor="content-source">{copy('Source', '来源')}<Select aria-label={copy('Source', '来源')} id="content-source" value={selectedSource} onChange={event => setSelectedSource(event.target.value)}><option value="">{copy('All collected sources', '所有已采集来源')}</option>{sources.data?.sources.map(source => <option key={source.id} value={source.id}>{sourceName(source)}</option>)}</Select></label>
          <label htmlFor="content-platform">{copy('Platform', '平台')}<Select aria-label={copy('Platform', '平台')} id="content-platform" value={platformFilter} onChange={event => setPlatformFilter(event.target.value)}><option value="">{copy('All platforms', '全部平台')}</option>{[...new Set([...capabilities.map(item => item.platform), ...(sources.data?.sources.map(item => item.platform) ?? [])])].map(value => <option key={value} value={value}>{value}</option>)}</Select></label>
          <label htmlFor="content-provider">{copy('Provider', '获取渠道')}<Select aria-label={copy('Provider', '获取渠道')} id="content-provider" value={providerFilter} onChange={event => setProviderFilter(event.target.value)}><option value="">{copy('All providers', '全部渠道')}</option>{[...new Set([...capabilities.map(item => item.provider), ...(sources.data?.sources.map(item => item.provider) ?? [])])].map(value => <option key={value} value={value}>{value}{isDemo(value) ? copy(' (synthetic)', '（合成）') : ''}</option>)}</Select></label>
          <label htmlFor="content-kind">{copy('Content type', '内容类型')}<Select aria-label={copy('Query content type', '查询内容类型')} id="content-kind" value={kind} onChange={event => setKind(event.target.value)}><option value="">{copy('All types', '全部类型')}</option>{[...new Set(sources.data?.capabilities.flatMap(item => item.contentKinds) ?? ['post', 'comment'])].map(value => <option key={value} value={value}>{kindLabel(value as PublicContentKind)}</option>)}</Select></label>
          <label htmlFor="content-from">{copy('Published from', '发布时间起点')}<Input id="content-from" type="datetime-local" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label htmlFor="content-to">{copy('Published before', '发布时间终点')}<Input id="content-to" type="datetime-local" value={to} onChange={event => setTo(event.target.value)} /></label>
          <Button type="submit" variant="primary" disabled={list.isFetching}>{copy('Search', '查询')}</Button>
        </form>
        <p className="content-muted">{copy('Collection uses the search time window, or the last 24 hours when dates are empty. Search only reads saved results.', '采集使用查询区的时间范围；日期留空时取最近 24 小时。查询只读取已保存结果。')}</p>
        <p role="note" className="content-muted">{copy('Saved-content search matches one continuous literal substring in title or text, retaining emoji and punctuation. Quotes and - are ordinary characters here. Collection keywords use the selected provider’s syntax and are separate from this local search.', '已存内容查询按标题或正文中的连续字面子串匹配，保留 emoji 与标点；引号和 - 在此仅为普通字符。采集关键词采用对应 provider 的语法，与本地查询分开。')}</p>
        {stats && <p className="content-summary">{copy('Saved matches', '已存匹配内容')} <strong>{stats.total}</strong> · {stats.byKind.map(item => `${kindLabel(item.kind)} ${item.count}`).join(' · ')} <span className="content-muted">{copy('Counts cover unique saved content, not all platform activity.', '统计范围为唯一已存内容，不代表平台全量。')}{stats.unknownPublishedAtCount > 0 ? ` ${copy('Unknown publication dates', '发布时间未知')}: ${stats.unknownPublishedAtCount}` : ''}</span></p>}
        {workbench.data && <details><summary>{copy('Unified source overview', '统一来源概览')}</summary>
          <p>{copy('By platform', '按平台')}: {workbench.data.byPlatform.map(item => `${item.platform} ${item.count}`).join(' · ') || '—'}</p>
          <p>{copy('By provider', '按获取渠道')}: {workbench.data.byProvider.map(item => `${item.provider} ${item.count}`).join(' · ') || '—'}</p>
          <p className="content-muted">{copy('Provider counts may share content identities and cannot be summed into the total. Metrics retain platform units; score, likes and views are not combined into a common heat value.', '不同 provider 可能获取相同内容，其条数不能相加得到全局总数。指标保留平台单位；score、点赞与浏览量不合并为通用热度。')}</p>
        </details>}
        {stats && stats.daily.length > 0 && <details><summary>{copy('Daily saved counts (UTC)', '每日已存内容数（UTC）')}</summary><ol className="content-daily">{stats.daily.map(day => <li key={day.day}><span>{day.day}</span><strong>{day.count}</strong></li>)}</ol></details>}
        <ContentExport filters={filters} zh={zh} />
        {list.isLoading && <p role="status">{copy('Loading content…', '正在加载内容…')}</p>}
        {list.data?.items.length === 0 && <p className="content-empty">{copy('No saved content matches. Change the filters or collect a source.', '没有匹配的已存内容。可调整筛选条件，或先采集来源。')}</p>}
        <div className="content-results">{list.data?.items.map(item => <article key={item.id} className="content-result">
          <div className="content-meta"><span>{item.platform} · {kindLabel(item.kind)}{item.observations.some(obs => isDemo(obs.provider)) ? ` · ${copy('SYNTHETIC DEMO', '合成演示')}` : ''}</span><span>{item.author?.handle ?? copy('Author unavailable', '作者未知')}</span><span>{copy('Published', '发布')} {time(item.publishedAt)}</span></div>
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
