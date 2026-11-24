import { useState } from 'react';
import { formatApiError, useContentListQuery, useProjectsQuery, useSourceJobsQuery } from '../api/hooks';
import { Skeleton } from './ui/skeleton';
import { formatContentAuthor, type CollectionSource } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function ResearchSourceProjects({ sourceId }: { sourceId: string }) {
  const { t } = useI18n();
  const query = useProjectsQuery(true);
  const projects = query.data?.projects.filter(project => project.is_shared && project.dataset_mode !== 'batch' && project.source_ids.includes(sourceId));
  return <section className="source-domain-section">
    <h3>{t('Research projects using this source', '使用此来源的研究项目')}</h3>
    {query.isPending && <p role="status">{t('Loading projects…', '正在加载专题…')}</p>}
    {query.isError && <p role="alert">{formatApiError(query.error)}</p>}
    {projects?.length === 0 && <p>{t('No shared monitoring project uses this source yet.', '尚无共享研究项目使用此来源。')}</p>}
    {projects && projects.length > 0 && <ul>{projects.map(project => <li key={project.id}>
      <a href={'/projects?projectId=' + project.id}>{project.name}</a>
    </li>)}</ul>}
    <p className="collection-hint">{t('Scheduling fetches content for this source. Add batches to batch-based projects in the project workspace.', '定时采集会更新此来源的数据。批次型专题需在项目工作区添加批次。')}</p>
    <a href={'/projects?new=1&sourceId=' + sourceId}>{t('Create a monitoring project', '新建此来源的监测项目')}</a>
  </section>;
}

export function FeedSourcePreview({ source }: { source: CollectionSource }) {
  const { t, lang } = useI18n();
  const sourceId = source.id;
  const query = useContentListQuery({ sourceId, limit: 8 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return <section className="source-domain-section">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0 }}>{t('Recently stored stories', '最近入库资讯')}</h3>
      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
        {source.feedLane}{source.qualityGrade ? ` · Grade ${source.qualityGrade}` : ''} · {source.coverage === 'partial' ? t('Partial/snapshot coverage', '部分/快照覆盖') : t('Coverage unknown', '覆盖口径未知')}
      </span>
    </div>
    {source.health.lastNotModified && <p>{t('Last check found no changes.', '最近检查发现内容未更新。')}</p>}
    {!source.health.lastNotModified && source.health.lastStatus === 'succeeded' && source.health.lastFetchedCount === 0 &&
      <p>{t('Last fetch succeeded with no new items.', '最近抓取成功，暂无新内容。')}</p>}
    {source.health.lastStatus === 'failed' && <p role="status">{t('Last fetch failed. Open diagnostics for the cause.', '最近抓取失败，可打开技术诊断查看原因。')}</p>}
    {query.isPending && <div role="status"><span>{t('Loading stories…', '正在加载资讯…')}</span><Skeleton className="source-story-placeholder" /></div>}
    {query.isError && <p role="alert">{formatApiError(query.error)}</p>}
    {query.data?.items.length === 0 && <p>{source.deliveryMode === 'pull' ? t('No stories stored yet. Preview the subscription or run a fetch.', '暂无入库资讯。可先预览订阅或执行一次抓取。') : t('No stories stored yet. They will appear here after an external delivery.', '暂无入库资讯，收到外部推送后会在这里显示。')}</p>}
    {query.data && query.data.items.length > 0 && <ul className="source-story-list">{query.data.items.map(item => {
      const isExpanded = expandedId === item.id;
      const dt = item.publishedAt ?? item.firstFetchedAt;
      const snippet = (item.text ?? '').trim();
      const authorLabel = formatContentAuthor(item.author);
      return (
        <li key={item.id} style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ fontSize: 13 }}>{item.title || snippet.slice(0, 120) || t('Untitled', '无标题')}</strong>
            {dt && <time style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }} dateTime={dt}>{new Date(dt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en')}</time>}
          </div>
          {snippet && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 }}>
              {isExpanded ? snippet : `${snippet.slice(0, 180)}${snippet.length > 180 ? '…' : ''}`}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
            <span>{item.kind}</span>
            <span className="state-chip">{item.textState}</span>
            {authorLabel && <span>{authorLabel}</span>}
            {item.language && <span>{item.language}</span>}
            {snippet.length > 180 && (
              <button
                type="button"
                className="collection-text-button"
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
              >
                {isExpanded ? t('Collapse excerpt', '收起正文') : t('Read inline', '展开正文')}
              </button>
            )}
            {item.url && /^https?:\/\//i.test(item.url) && (
              <a href={item.url} target="_blank" rel="noreferrer">{t('Open original', '访问原文')}</a>
            )}
          </div>
        </li>
      );
    })}</ul>}
    <a href={'/content?sourceId=' + sourceId}>{t('View all stored content in repository', '在内容库中查看全部入库内容')}</a>
  </section>;
}

export function SourceJobHistory({ sourceId, onInspect }: { sourceId: string; onInspect: (id: string) => void }) {
  const { t } = useI18n();
  const query = useSourceJobsQuery(sourceId);
  const statusLabels: Record<string, string> = {
    queued: t('Queued', '已排队'), running: t('Running', '执行中'), retrying: t('Retrying', '等待重试'),
    succeeded: t('Succeeded', '已成功'), completed: t('Completed', '已完成'),
    failed: t('Failed', '失败'), cancelled: t('Cancelled', '已取消'),
  };
  return <section className="source-domain-section">
    <h3>{t('Recent collection jobs', '最近采集任务')}</h3>
    {query.isPending && <p role="status">{t('Loading jobs…', '正在加载任务…')}</p>}
    {query.isError && <p role="alert">{formatApiError(query.error)}</p>}
    {query.data?.jobs.length === 0 && <p>{t('No jobs for this source yet.', '此来源暂无任务记录。')}</p>}
    {query.data && query.data.jobs.length > 0 && <ul className="source-story-list">{query.data.jobs.slice(0, 5).map(job => <li key={job.id}>
      <span>{statusLabels[job.status] ?? t('Status unavailable', '状态暂不可用')} · {t('Stored', '入库')} {job.records_inserted ?? '—'}</span>
      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onInspect(job.id)}>{t('Job details', '任务详情')} · {job.id.slice(0, 8)}</button>
    </li>)}</ul>}
    <a href={'/sources?tab=jobs&sourceId=' + sourceId}>{t('View all jobs for this source', '查看此来源全部任务')}</a>
  </section>;
}
