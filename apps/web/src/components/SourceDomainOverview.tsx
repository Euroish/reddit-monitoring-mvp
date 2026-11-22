import { formatApiError, useContentListQuery, useProjectsQuery, useSourceJobsQuery } from '../api/hooks';
import type { CollectionSource } from '../contracts/api';
import { useI18n } from '../i18n/translations';
import { sourceNeedsAttention } from '../lib/collectionLimits';

export function SourceDomainSummary({ sources, domain }: { sources: CollectionSource[]; domain: 'research' | 'feed' }) {
  const { t } = useI18n();
  const research = domain === 'research';
  const active = sources.filter(source => source.state === 'active');
  const scheduled = active.filter(source => source.schedule?.enabled && !source.automaticCollectionBlocked);
  const stats = [
    [research ? t('Active targets', '已启用研究目标') : t('Active feed sources', '已启用资讯源'), active.length],
    [research ? t('Scheduled collection', '已开启定时采集') : t('Scheduled updates', '已开启定时更新'), scheduled.length],
    [research ? t('Needs attention', '需处理的来源') : t('Fetch or parse alerts', '需检查抓取或解析'), active.filter(sourceNeedsAttention).length],
  ];
  return <dl className="source-domain-summary">{stats.map(([label, count]) => (
    <div key={label}><dt>{label}</dt><dd>{count}</dd></div>
  ))}</dl>;
}

export function ResearchSourceProjects({ sourceId }: { sourceId: string }) {
  const { t } = useI18n();
  const query = useProjectsQuery(true);
  const projects = query.data?.projects.filter(project => project.is_shared && project.dataset_mode !== 'batch' && project.source_ids.includes(sourceId));
  return <section className="source-domain-section">
    <h3>{t('Linked shared research', '关联共享专题')}</h3>
    {query.isPending && <p role="status">{t('Loading projects…', '正在加载专题…')}</p>}
    {query.isError && <p role="alert">{formatApiError(query.error)}</p>}
    {projects?.length === 0 && <p>{t('No shared project explicitly includes this source in its source filter.', '暂无共享专题在来源筛选中明确关联此来源。')}</p>}
    {projects && projects.length > 0 && <ul>{projects.map(project => <li key={project.id}>
      <a href={'/projects?projectId=' + project.id}>{project.name}</a>
    </li>)}</ul>}
    <p className="collection-hint">{t('Scheduling fetches content for this source. Add batches to batch-based projects in the project workspace.', '定时采集会更新此来源的数据。批次型专题需在项目工作区添加批次。')}</p>
    <a href={'/projects?new=1&sourceId=' + sourceId}>{t('Create a monitoring project', '新建此来源的监测项目')}</a>
  </section>;
}

export function FeedSourcePreview({ sourceId }: { sourceId: string }) {
  const { t } = useI18n();
  const query = useContentListQuery({ sourceId, limit: 5 });
  return <section className="source-domain-section">
    <h3>{t('Recently stored stories', '最近入库资讯')}</h3>
    {query.isPending && <p role="status">{t('Loading stories…', '正在加载资讯…')}</p>}
    {query.isError && <p role="alert">{formatApiError(query.error)}</p>}
    {query.data?.items.length === 0 && <p>{t('No stories are stored yet. Run a fetch to populate this preview.', '此来源暂无入库资讯。可先执行一次抓取。')}</p>}
    {query.data && query.data.items.length > 0 && <ul className="source-story-list">{query.data.items.map(item => <li key={item.id}>
      <strong>{item.title || item.text?.slice(0, 120) || t('Untitled', '无标题')}</strong>
      {(item.publishedAt ?? item.firstFetchedAt) && <time dateTime={item.publishedAt ?? item.firstFetchedAt}>{(item.publishedAt ?? item.firstFetchedAt).slice(0, 10)}</time>}
    </li>)}</ul>}
    <a href={'/content?sourceId=' + sourceId}>{t('View all stored content', '查看全部入库内容')}</a>
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
      <span>{statusLabels[job.status] ?? job.status} · {t('Stored', '入库')} {job.records_inserted ?? '—'}</span>
      <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onInspect(job.id)}>{t('Job details', '任务详情')} · {job.id.slice(0, 8)}</button>
    </li>)}</ul>}
    <a href={'/sources?tab=jobs&sourceId=' + sourceId}>{t('View all jobs for this source', '查看此来源全部任务')}</a>
  </section>;
}
