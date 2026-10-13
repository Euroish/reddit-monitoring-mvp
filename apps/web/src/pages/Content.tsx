import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, fetchApi } from '../api/client';
import { Button, Input, Select } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { CollectionSource, CollectionSourceResponse, ContentListResponse, ContentWorkbenchResponse, PublicContentKind, SourceJobResponse, SourceListResponse, SourceTarget } from '../../../../packages/contracts/src/http';
import { SourceSettings } from '../features/content/SourceSettings';
import { SourceTasks } from '../features/content/SourceTasks';
import { SourceOperations } from '../features/content/SourceOperations';
import { ContentExport } from '../features/content/ContentExport';
import { SaveContentQuery } from '../features/content/SaveContentQuery';
import { CreateResearchExport } from '../features/content/ResearchExports';
import { contentExclusionsFromDraft, contentFilterDraft, contentQueryFromDraft, contentQueryFromParams, contentQueryParams, safeContentUrl, type ContentFilterDraft } from '../features/content/queryState';
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
  const [params, setParams] = useSearchParams();
  const appliedQuery = contentQueryFromParams(params);
  const filters = contentQueryParams(appliedQuery);
  const [draftState, setDraftState] = useState(() => ({ base: filters, value: contentFilterDraft(appliedQuery) }));
  const draft = draftState.base === filters ? draftState.value : contentFilterDraft(appliedQuery);
  const updateFilter = (key: keyof ContentFilterDraft, value: string) => setDraftState(previous => ({ base: filters, value: { ...(previous.base === filters ? previous.value : contentFilterDraft(appliedQuery)), [key]: value } }));
  const platformFilter = draft.platform, providerFilter = draft.provider, keyword = draft.query, selectedSource = draft.sourceId, kind = draft.kind, from = draft.from, to = draft.to;
  const setPlatformFilter = (value: string) => updateFilter('platform', value), setProviderFilter = (value: string) => updateFilter('provider', value), setKeyword = (value: string) => updateFilter('query', value), setSelectedSource = (value: string) => updateFilter('sourceId', value), setKind = (value: string) => updateFilter('kind', value), setFrom = (value: string) => updateFilter('from', value), setTo = (value: string) => updateFilter('to', value);
  const [paging, setPaging] = useState({ base: filters, cursor: '', previous: [] as string[] });
  const cursor = paging.base === filters ? paging.cursor : '', previous = paging.base === filters ? paging.previous : [];
  const setCursor = (value: string) => setPaging(old => ({ base: filters, previous: old.base === filters ? old.previous : [], cursor: value }));
  const setPrevious = (value: string[]) => setPaging(old => ({ base: filters, cursor: old.base === filters ? old.cursor : '', previous: value }));
  const [queryError, setQueryError] = useState('');
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
  const searchFailure = [list.error, workbench.error].find(error => error instanceof ApiError && error.code === 'public_search_unavailable');
  const stats = searchFailure ? undefined : workbench.data?.stats;
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
  const sourceState = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'archive' }) => fetchApi<CollectionSourceResponse>(`/v1/sources/${id}/${action}`, { method: 'POST', body: JSON.stringify({ expectedRevision: sources.data?.sources.find(source => source.id === id)?.revision }) }), onSuccess: data => {
    client.setQueryData<SourceListResponse>(['contentSources'], previous => previous ? { ...previous, sources: previous.sources.map(item => item.id === data.source.id ? data.source : item) } : previous);
    void client.invalidateQueries({ queryKey: ['contentSources'] }); void client.invalidateQueries({ queryKey: ['sourceJobs'] }); void client.invalidateQueries({ queryKey: ['sourceOps'] });
  },
    onError: () => { void client.invalidateQueries({ queryKey: ['contentSources'] }); } });
  const search = (event: FormEvent) => {
    event.preventDefault(); setQueryError('');
    if (from && to && Date.parse(from) >= Date.parse(to)) { setQueryError(copy('Publication start must be before the end.', '发布时间起点必须早于终点。')); return; }
    if (draft.minMetric && draft.maxMetric && Number(draft.minMetric) > Number(draft.maxMetric)) { setQueryError(copy('Metric minimum must not exceed the maximum.', '指标最小值不能大于最大值。')); return; }
    try { contentExclusionsFromDraft(draft.exclusions); } catch { setQueryError(copy('Use at most 10 exclusion lines, each containing 1–200 characters.', '排除短语最多 10 行，每行 1–200 个字符。')); return; }
    setParams(contentQueryParams(contentQueryFromDraft(draft))); setCursor(''); setPrevious([]);
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
  const searchCoverage = searchFailure ? undefined : list.data?.searchCoverage ?? stats?.searchCoverage;
  return (
    <div className="source-content-page">
      <header className="content-heading"><h1>{copy('Collected content', '来源内容查询')}</h1><p>{copy('Search saved content across sources. Manage collection, tasks and budgets without changing the source identity.', '跨来源查询已存内容，并管理采集计划、任务和预算。')}</p></header>
      {failure && <p role="alert" className="content-error">{failure.message} <Button onClick={() => { void sources.refetch(); void list.refetch(); void workbench.refetch(); }}>{copy('Refresh results', '刷新结果')}</Button></p>}
      <section aria-labelledby="sources-title" className="content-source-section">
        <h2 id="sources-title">{copy('Sources', '数据来源')}</h2>
        <p className="content-muted">{copy('Provider availability follows local configuration. Demo providers generate synthetic data and never represent live platform coverage.', 'Provider 可用性以本地配置为准；Demo provider 生成合成数据，不代表真实平台内容或覆盖。')}</p>
        <details className="content-source-disclosure" open={sources.data?.sources.length === 0}><summary>{canCollect ? copy('View and manage sources', '查看与管理来源') : copy('View sources', '查看来源')} ({sources.data?.sources.length ?? 0})</summary>
        <Button type="button" disabled={sources.isFetching} onClick={() => void sources.refetch()}>{copy('Refresh sources', '刷新来源')}</Button>
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
          <label htmlFor="content-search-mode">{copy('Search mode', '检索模式')}<Select id="content-search-mode" aria-label={copy('Search mode', '检索模式')} value={draft.searchMode || 'literal'} onChange={event => updateFilter('searchMode', event.target.value)}><option value="literal">{copy('Literal substring', '字面子串')}</option><option value="terms">{copy('All terms (AND)', '所有词项（AND）')}</option><option value="phrase">{copy('Continuous phrase', '连续短语')}</option></Select></label>
          <label htmlFor="content-search-scope">{copy('Search fields', '检索字段')}<Select id="content-search-scope" aria-label={copy('Search fields', '检索字段')} value={draft.searchScope || 'title_text'} onChange={event => updateFilter('searchScope', event.target.value)}><option value="title_text">{copy('Combined title and text', '标题与正文组合')}</option><option value="title">{copy('Title only', '仅标题')}</option><option value="text">{copy('Stored text only', '仅已存正文')}</option></Select></label>
          <label htmlFor="content-source">{copy('Source', '来源')}<Select aria-label={copy('Source', '来源')} id="content-source" value={selectedSource} onChange={event => setSelectedSource(event.target.value)}><option value="">{copy('All collected sources', '所有已采集来源')}</option>{sources.data?.sources.map(source => <option key={source.id} value={source.id}>{sourceName(source)}</option>)}</Select></label>
          <label htmlFor="content-platform">{copy('Platform', '平台')}<Select aria-label={copy('Platform', '平台')} id="content-platform" value={platformFilter} onChange={event => setPlatformFilter(event.target.value)}><option value="">{copy('All platforms', '全部平台')}</option>{[...new Set([...capabilities.map(item => item.platform), ...(sources.data?.sources.map(item => item.platform) ?? [])])].map(value => <option key={value} value={value}>{value}</option>)}</Select></label>
          <label htmlFor="content-provider">{copy('Provider', '获取渠道')}<Select aria-label={copy('Provider', '获取渠道')} id="content-provider" value={providerFilter} onChange={event => setProviderFilter(event.target.value)}><option value="">{copy('All providers', '全部渠道')}</option>{[...new Set([...capabilities.map(item => item.provider), ...(sources.data?.sources.map(item => item.provider) ?? [])])].map(value => <option key={value} value={value}>{value}{isDemo(value) ? copy(' (synthetic)', '（合成）') : ''}</option>)}</Select></label>
          <label htmlFor="content-kind">{copy('Content type', '内容类型')}<Select aria-label={copy('Query content type', '查询内容类型')} id="content-kind" value={kind} onChange={event => setKind(event.target.value)}><option value="">{copy('All types', '全部类型')}</option>{[...new Set(sources.data?.capabilities.flatMap(item => item.contentKinds) ?? ['post', 'comment'])].map(value => <option key={value} value={value}>{kindLabel(value as PublicContentKind)}</option>)}</Select></label>
          <label htmlFor="content-author">{copy('Author', '作者')}<Input id="content-author" value={draft.author} onChange={event => updateFilter('author', event.target.value)} maxLength={200} placeholder={copy('Exact ID or handle', '准确 ID 或账号名')} /></label>
          <label htmlFor="content-language">{copy('Content language', '内容语言')}<Input id="content-language" value={draft.language} onChange={event => updateFilter('language', event.target.value)} maxLength={32} placeholder="en / zh" /></label>
          <label htmlFor="content-group">{copy('Source group', '来源集合')}<Select aria-label={copy('Source group', '来源集合')} id="content-group" value={draft.sourceGroup} onChange={event => updateFilter('sourceGroup', event.target.value)}><option value="">{copy('All source groups', '全部来源集合')}</option>{[...new Set([...(sources.data?.sources.flatMap(source => source.group ? [source.group] : []) ?? []), ...(draft.sourceGroup ? [draft.sourceGroup] : [])])].sort().map(group => <option key={group} value={group}>{group}</option>)}</Select></label>
          <label htmlFor="content-sort">{copy('Publication order', '发布时间排序')}<Select aria-label={copy('Publication order', '发布时间排序')} id="content-sort" value={draft.sort} onChange={event => updateFilter('sort', event.target.value)}><option value="published_desc">{copy('Newest first', '最新优先')}</option><option value="published_asc">{copy('Oldest first', '最早优先')}</option></Select></label>
          <label htmlFor="content-metric">{copy('Metric', '指标')}<Select aria-label={copy('Metric', '指标')} id="content-metric" value={draft.metricKey} onChange={event => updateFilter('metricKey', event.target.value)}><option value="">{copy('No metric filter', '不按指标筛选')}</option>{[...new Set([...capabilities.flatMap(capability => capability.metrics.map(metric => metric.key)), ...(draft.metricKey ? [draft.metricKey] : [])])].map(key => <option key={key} value={key}>{metricLabel(key)} · {key}</option>)}</Select></label>
          <label htmlFor="content-min-metric">{copy('Metric minimum', '指标最小值')}<Input id="content-min-metric" type="number" step="any" disabled={!draft.metricKey} value={draft.minMetric} onChange={event => updateFilter('minMetric', event.target.value)} /></label>
          <label htmlFor="content-max-metric">{copy('Metric maximum', '指标最大值')}<Input id="content-max-metric" type="number" step="any" disabled={!draft.metricKey} value={draft.maxMetric} onChange={event => updateFilter('maxMetric', event.target.value)} /></label>
          <label htmlFor="content-from">{copy('Published from', '发布时间起点')}<Input id="content-from" type="datetime-local" step="0.001" value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label htmlFor="content-to">{copy('Published before', '发布时间终点')}<Input id="content-to" type="datetime-local" step="0.001" value={to} onChange={event => setTo(event.target.value)} /></label>
          <label htmlFor="content-exclusions">{copy('Exclusions (one phrase per line, max 10)', '排除短语（每行一条，最多 10 条）')}<textarea id="content-exclusions" aria-label={copy('Exclusion phrases', '排除短语')} rows={3} maxLength={2010} value={draft.exclusions} onChange={event => updateFilter('exclusions', event.target.value)} /></label>
          <Button type="submit" variant="primary" disabled={list.isFetching}>{copy('Search', '查询')}</Button>
        </form>
        {queryError && <p role="alert" className="content-error">{queryError}</p>}
        <p className="content-muted">{copy('Filters are stored in this URL. Share or bookmark it to reopen the same query. Author IDs/handles and language use exact, case-insensitive matching; source groups match their case-sensitive setting. Metric bounds use the latest observation per source within the selected scope; a matching value from any source is sufficient. Missing values are excluded, never treated as zero.', '筛选条件保存在当前 URL，可分享或收藏后恢复。作者 ID/账号名和语言采用忽略大小写的准确匹配；来源集合名称区分大小写。指标范围使用当前筛选范围内每个来源的最新观测，任一来源的数值符合范围即可；缺失值排除，不当作 0。')}</p>
        <p className="content-muted">{copy('Date inputs use your local time; the URL records UTC instants. Start is inclusive and end is exclusive. A date filter excludes unknown publication times; daily buckets use UTC. Equal publication times have a stable identity order.', '日期输入使用本地时间，URL 保存 UTC 时刻；包含起点、不包含终点。设置日期筛选后排除发布时间未知的内容，每日统计按 UTC 分桶；相同发布时间按内容身份稳定排序。')}</p>
        <SaveContentQuery query={appliedQuery} zh={zh} />
        <p className="content-muted">{copy('Collection uses the search time window, or the last 24 hours when dates are empty. Search only reads saved results.', '采集使用查询区的时间范围；日期留空时取最近 24 小时。查询只读取已保存结果。')}</p>
        <p role="note" className="content-muted">{copy('Search covers retained title/text, not unseen source body text. It normalizes Unicode compatibility, letter case and whitespace, retaining emoji and punctuation. Literal and phrase modes require continuous text; terms splits on whitespace and requires every substring (AND). Exclusions are literal phrases in the chosen fields; commas, quotes and - stay ordinary characters. Provider collection syntax is separate.', '检索范围为已保留的标题/正文，不包含未存的上游正文。检索统一 Unicode 兼容形式、大小写和空白，保留 emoji 与标点；字面与短语模式要求连续文本，词项模式按空白拆分并要求每个子串均匹配（AND）。排除项在所选字段中按字面短语匹配，逗号、引号和 - 仍为普通字符；provider 采集语法单独使用。')}</p>
        {searchFailure && <p role="alert" className="content-error">{copy('Text search could not confirm complete index coverage in this stored scope. Your filters are preserved. An administrator should inspect storage and run a controlled backfill if needed; refreshing does not rebuild the index. This is not an empty search result.', '当前已存范围未能确认完整索引覆盖，文本检索不可用，筛选条件已保留。请由管理员检查存储并按需受控回填；刷新不会自动重建索引，此状态不表示搜索结果为零。')}</p>}
        {searchCoverage ? <p className="content-summary" data-testid="content-search-coverage">{copy('Stored search coverage', '已存检索覆盖')}: {searchCoverage.state} · {copy('Candidates before text filtering', '文本筛选前候选')} {searchCoverage.candidateCount} · {copy('Indexed', '已索引')} {searchCoverage.indexed} · {copy('Unindexed', '未索引')} {searchCoverage.unindexed}<span className="content-muted">{copy('Indexed records with stored body text', '已索引且有已存正文')} {searchCoverage.textPresent} · {copy('Indexed records missing body text', '已索引但正文缺失')} {searchCoverage.textMissing} · {searchCoverage.textBasis} · v{searchCoverage.formatVersion}{copy(' · A stored empty string counts as known text; title alone does not.', ' · 已知空字符串仍计入有正文，仅有标题不计入。')}</span></p> : !searchFailure && <p className="content-muted">{copy('Measured search coverage has not been supplied by this response.', '当前响应尚未提供实测检索覆盖信息。')}</p>}
        {stats && <p className="content-summary">{copy('Saved matches', '已存匹配内容')} <strong>{stats.total}</strong> · {stats.byKind.map(item => `${kindLabel(item.kind)} ${item.count}`).join(' · ')} <span className="content-muted">{copy('Counts cover unique saved content, not all platform activity.', '统计范围为唯一已存内容，不代表平台全量。')}{stats.unknownPublishedAtCount > 0 ? ` ${copy('Unknown publication dates', '发布时间未知')}: ${stats.unknownPublishedAtCount}` : ''}</span></p>}
        {workbench.data && !searchFailure && <details><summary>{copy('Unified source overview', '统一来源概览')}</summary>
          <p>{copy('By platform', '按平台')}: {workbench.data.byPlatform.map(item => `${item.platform} ${item.count}`).join(' · ') || '—'}</p>
          <p>{copy('By provider', '按获取渠道')}: {workbench.data.byProvider.map(item => `${item.provider} ${item.count}`).join(' · ') || '—'}</p>
          <p className="content-muted">{copy('Provider counts may share content identities and cannot be summed into the total. Metrics retain platform units; score, likes and views are not combined into a common heat value.', '不同 provider 可能获取相同内容，其条数不能相加得到全局总数。指标保留平台单位；score、点赞与浏览量不合并为通用热度。')}</p>
        </details>}
        {stats && stats.daily.length > 0 && <details><summary>{copy('Daily saved counts (UTC)', '每日已存内容数（UTC）')}</summary><ol className="content-daily">{stats.daily.map(day => <li key={day.day}><span>{day.day}</span><strong>{day.count}</strong></li>)}</ol></details>}
        <ContentExport filters={filters} zh={zh} />
        <CreateResearchExport query={appliedQuery} zh={zh} />
        {list.isLoading && <p role="status">{copy('Loading content…', '正在加载内容…')}</p>}
        {!searchFailure && list.data?.items.length === 0 && <p className="content-empty">{copy('No saved content matches. Change the filters or collect a source.', '没有匹配的已存内容。可调整筛选条件，或先采集来源。')}</p>}
        <div className="content-results">{!searchFailure && list.data?.items.map(item => <article key={item.id} className="content-result">
          <div className="content-meta"><span>{item.platform} · {kindLabel(item.kind)}{item.observations.some(obs => isDemo(obs.provider)) ? ` · ${copy('SYNTHETIC DEMO', '合成演示')}` : ''}</span><span>{item.author?.handle ?? copy('Author unavailable', '作者未知')}</span><span>{copy('Published', '发布')} {time(item.publishedAt)}</span></div>
          <h3><Link to={`/content/${encodeURIComponent(item.id)}?back=${encodeURIComponent(`/content${filters ? `?${filters}` : ''}`)}`}>{item.title || kindLabel(item.kind)}</Link></h3>
          {safeContentUrl(item.url) && <a href={safeContentUrl(item.url)!} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{copy('Open original', '打开原链接')}</a>}
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
