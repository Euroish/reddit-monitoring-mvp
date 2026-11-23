import type { ReactNode } from 'react';
import { AlertCircle, CalendarClock, ExternalLink, Radio, Rss } from 'lucide-react';
import type { CollectionSource } from '../contracts/api';
import { formatSourceTarget } from '../contracts/api';
import { useSourceStatus } from '../lib/sourceStatus';
import { useI18n } from '../i18n/translations';
import { FeedSourcePreview, ResearchSourceProjects } from './SourceDomainOverview';
import { Button } from './ui/button';

type Section = 'overview' | 'plan' | 'jobs' | 'technical';
type DetailProps = {
  source: CollectionSource;
  section: Section;
  readiness?: ReactNode;
  update: ReactNode;
  jobHistory: ReactNode;
  diagnostics: ReactNode;
  onRun?: () => void;
  onPreview?: () => void;
  onJobs: () => void;
};

function SourceDiagnostics({ source, section, diagnostics, jobHistory }: Pick<DetailProps, 'source' | 'section' | 'diagnostics' | 'jobHistory'>) {
  const { t } = useI18n();
  return <>
    <details className="source-detail-disclosure" open={section === 'jobs' ? true : undefined}>
      <summary>{source.deliveryMode === 'push' ? t('Delivery records', '推送记录') : t('Collection history', '任务记录')}</summary>{jobHistory}
    </details>
    <details className="source-detail-disclosure" open={section === 'technical' ? true : undefined}>
      <summary>{t('Technical details', '技术诊断')}</summary>
      <dl className="source-technical-details">
        <div><dt>{t('Provider', '采集服务')}</dt><dd>{source.primaryProvider}</dd></div>
        <div><dt>{t('Revision', '版本')}</dt><dd>{source.revision}</dd></div>
        {source.sourceGroup && <div><dt>{t('Source group', '来源分类')}</dt><dd>{source.sourceGroup}</dd></div>}
        {source.lastCheckedAt && <div><dt>{t('Last check (UTC)', '上次检查（UTC）')}</dt><dd>{source.lastCheckedAt}</dd></div>}
      </dl>
      {diagnostics}
    </details>
  </>;
}

export function ResearchSourceDetail({ source, section, readiness, update, jobHistory, diagnostics, onRun, onJobs }: DetailProps) {
  const { t } = useI18n();
  const { timestamp, status } = useSourceStatus();
  return <div className="source-detail-stack">
    <section className="source-detail-section">
      <div className="source-section-heading">
        <div>
          <h3>{t('Latest collection', '最近一次采集')}</h3>
          <strong>{status(source)}</strong>
          {source.lastSuccessAt && <p>{t('Last success', '最近成功')} · <time dateTime={source.lastSuccessAt}>{timestamp(source.lastSuccessAt)}</time></p>}
        </div>
        {onRun && <Button type="button" className="intake-primary" onClick={onRun}>{t('Run once', '运行一次')}</Button>}
      </div>
      {source.health.lastInsertedCount !== undefined && source.health.lastInsertedCount !== null && <p>{t(`${source.health.lastInsertedCount} new items saved on the last run.`, `上次运行新增入库 ${source.health.lastInsertedCount} 条。`)}</p>}
      {source.health.lastError && <details className="source-detail-disclosure"><summary><AlertCircle size={15} />{t('Recent run failed · diagnostic details', '最近一次运行失败 · 查看诊断详情')}</summary><p>{source.health.lastError}</p></details>}
      {readiness}
      <button type="button" className="collection-text-button" onClick={onJobs}>{t('View jobs for this source', '查看此来源的任务')}</button>
    </section>
    <section className="source-detail-section">
      <h3><CalendarClock size={16} />{source.deliveryMode === 'pull' ? t('Collection plan', '自动采集与执行计划') : t('External delivery', '外部推送')}</h3>
      {update}
    </section>
    <ResearchSourceProjects sourceId={source.id} />
    <SourceDiagnostics source={source} section={section} diagnostics={diagnostics} jobHistory={jobHistory} />
  </div>;
}

export function FeedSourceDetail({ source, section, readiness, update, jobHistory, diagnostics, onPreview, onJobs }: DetailProps) {
  const { t } = useI18n();
  const { status, timestamp } = useSourceStatus();
  const pull = source.deliveryMode === 'pull';
  return <div className="source-detail-stack feed-source-detail">
    <FeedSourcePreview source={source} />
    <section className="source-detail-section">
      <div className="source-section-heading">
        <div>
          <h3>{pull ? <Rss size={16} /> : <Radio size={16} />}{pull ? t('Subscription and updates', '订阅与更新') : t('External delivery', '外部推送')}</h3>
          <p><strong>{status(source)}</strong>{source.lastCheckedAt && <> · <time dateTime={source.lastCheckedAt}>{timestamp(source.lastCheckedAt)}</time></>}</p>
          {pull && <p className="source-target-address">{formatSourceTarget(source.target)}</p>}
          {source.health.lastInsertedCount != null && <p>{t(`${source.health.lastInsertedCount} new items saved on the last run.`, `上次运行新增入库 ${source.health.lastInsertedCount} 条。`)}</p>}
        </div>
        {onPreview && <Button type="button" variant="outline" onClick={onPreview}><ExternalLink size={14} />{t('Preview fetch', '预览抓取')}</Button>}
      </div>
      {readiness}
      {update}
      <button type="button" className="collection-text-button" onClick={onJobs}>{pull ? t('View jobs for this source', '查看此来源的任务') : t('View delivery records', '查看推送记录')}</button>
    </section>
    <SourceDiagnostics source={source} section={section} diagnostics={diagnostics} jobHistory={jobHistory} />
  </div>;
}
