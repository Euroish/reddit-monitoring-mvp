import '../styles/collection.css';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  type AiCandidateItem,
  useAiAdminMutations,
  useAiAdminRankingsQuery,
  useAiOpsAuditQuery,
  useAiOpsSummaryQuery,
  useAiQueueQuery,
  useAiVendorsQuery,
} from '../api/ai-client';
import { formatApiError, isMfaRequiredError } from '../api/hooks';
import { InlineMfaStepUp } from '../components/InlineMfaStepUp';
import { AiEventsAdminPanel } from '../components/ai/AiEventsAdminPanel';
import { AiSourceOperations } from '../components/ai/AiSourceOperations';
import type { Actor } from '../contracts/api';
import { useI18n } from '../i18n/translations';

interface AiReviewQueuePageProps {
  actor: Actor;
  onNavigate: (path: string) => void;
}

const EVENT_TYPES = [
  'model_release',
  'model_update',
  'api_release',
  'preview',
  'ga',
  'pricing_change',
  'deprecation',
  'retirement',
  'other',
] as const;

export function AiReviewQueuePage({ actor, onNavigate }: AiReviewQueuePageProps) {
  const { t } = useI18n();
  const isAdmin = actor.clientKind === 'browser' && actor.role !== 'viewer';

  const [tab, setTab] = useState<'ops' | 'queue' | 'published' | 'sources'>('ops');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [vendorFilter, setVendorFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingRevision, setEditingRevision] = useState(1);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pendingMfaAction, setPendingMfaAction] = useState<(() => Promise<void>) | null>(null);

  const runWithMfa = async (fn: () => Promise<void>) => {
    setFeedback(null);
    try {
      await fn();
      setPendingMfaAction(null);
    } catch (err) {
      if (isMfaRequiredError(err)) setPendingMfaAction(() => fn);
      else setFeedback({ kind: 'err', text: formatApiError(err) });
    }
  };

  // Publish / edit form state
  const [formVendorId, setFormVendorId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formEventType, setFormEventType] = useState<string>('model_release');
  const [formEventStatus, setFormEventStatus] = useState<'released' | 'announced_future' | 'deprecated' | 'retired'>('released');
  const [formEventDate, setFormEventDate] = useState('');
  const [formDatePrecision, setFormDatePrecision] = useState<'day' | 'month'>('day');
  const [formPrimaryUrl, setFormPrimaryUrl] = useState('');
  const [formSummaryZh, setFormSummaryZh] = useState('');
  const [formSummaryEn, setFormSummaryEn] = useState('');
  const [formNote, setFormNote] = useState('');

  const vendorsQ = useAiVendorsQuery(isAdmin);
  const opsSummaryQ = useAiOpsSummaryQuery(7, isAdmin && tab === 'ops');
  const opsAuditQ = useAiOpsAuditQuery(isAdmin && tab === 'ops');
  const adminRankingsQ = useAiAdminRankingsQuery(isAdmin && tab === 'ops');
  const queueQ = useAiQueueQuery(
    { status: statusFilter || undefined, vendor: vendorFilter || undefined },
    isAdmin && tab === 'queue',
  );
  const mutations = useAiAdminMutations();

  const vendors = vendorsQ.data?.items ?? [];
  const candidates = useMemo(() => queueQ.data?.items ?? [], [queueQ.data?.items]);
  const activeCandidate = useMemo(
    () => candidates.find((c) => c.id === activeId) ?? null,
    [candidates, activeId],
  );

  const selectCandidate = (c: AiCandidateItem) => {
    setActiveId(c.id);
    setEditingRevision(c.revision);
    setFeedback(null);
    setFormVendorId(c.vendorId ?? vendors[0]?.id ?? '');
    setFormTitle(c.title);
    setFormEventType(c.suggestedEventType || 'model_release');
    setFormEventStatus('released');
    // Never fabricate today's date when suggestedDate is missing
    setFormEventDate(c.suggestedDate || '');
    setFormDatePrecision(c.datePrecision === 'month' ? 'month' : 'day');
    const draftUrl = typeof c.draftPayload?.officialUrl === 'string'
      ? c.draftPayload.officialUrl
      : typeof c.draftPayload?.url === 'string'
        ? c.draftPayload.url
        : '';
    setFormPrimaryUrl(draftUrl);
    setFormSummaryZh(typeof c.draftPayload?.summaryZh === 'string' ? c.draftPayload.summaryZh : '');
    setFormSummaryEn(typeof c.draftPayload?.summaryEn === 'string' ? c.draftPayload.summaryEn : '');
    setFormNote(c.reviewerNote ?? '');
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '48px auto' }}>
        <div className="ds-card" style={{ padding: 28, textAlign: 'center' }}>
          <ShieldAlert size={28} style={{ color: 'var(--coral)', marginBottom: 12 }} />
          <h2 style={{ margin: '0 0 8px' }}>{t('Administrator Access Required', '仅限管理员访问')}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: '0 0 18px' }}>
            {t(
              'The AI Release Review Queue requires an owner or admin browser session.',
              'AI 发布审核队列需要 owner 或 admin 角色权限。',
            )}
          </p>
          <button type="button" className="ds-btn" onClick={() => onNavigate('/ai')}>
            {t('Back to AI Releases', '返回 AI 资讯')}
          </button>
        </div>
      </div>
    );
  }

  const toggleChecked = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDismiss = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setFeedback(null);
    try {
      const res = await mutations.bulkDismiss.mutateAsync({ ids, reviewerNote: 'Bulk dismissed from review queue' });
      setSelectedIds(new Set());
      setFeedback({ kind: 'ok', text: t(`Dismissed ${res.dismissed} candidates.`, `已批量忽略 ${res.dismissed} 条候选。`) });
    } catch (e) {
      setFeedback({ kind: 'err', text: formatApiError(e) });
    }
  };

  async function runDiscovery(shadowMode: boolean) {
    if (!shadowMode && !window.confirm(t('Run discovery with automatic publishing for eligible vendors?', '执行发现并为符合条件的厂商自动发布？'))) return;
    setFeedback(null);
    try {
      const result = await mutations.runDiscovery.mutateAsync({ shadowMode, archiveLowValue: !shadowMode });
      setFeedback({ kind: 'ok', text: [
        t('Scanned', '扫描'), result.scanned, t('Non-official skipped', '跳过非官方'), result.skippedNonOfficial,
        t('Queued', '进入审核'), result.candidatesQueued, t('Published', '已发布'), result.autoPublished,
        t('Shadow passed', '影子通过'), result.shadowPassed, t('Archived', '已归档'), result.archived,
      ].join(' · ') });
    } catch (error) {
      setFeedback({ kind: 'err', text: formatApiError(error) });
    }
  }

  async function saveCandidateDraft() {
    if (!activeCandidate) return;
    setFeedback(null);
    try {
      const saved = await mutations.patch.mutateAsync({ id: activeCandidate.id, body: {
        expectedRevision: editingRevision,
        vendorId: formVendorId || null,
        title: formTitle.trim(),
        suggestedEventType: formEventType,
        suggestedDate: formEventDate || null,
        datePrecision: formEventDate ? formDatePrecision : 'unknown',
        reviewerNote: formNote.trim() || null,
        draftPayload: {
          ...activeCandidate.draftPayload,
          officialUrl: formPrimaryUrl.trim(),
          summaryZh: formSummaryZh.trim(),
          summaryEn: formSummaryEn.trim(),
        },
      } });
      setEditingRevision(saved.revision);
      setFeedback({ kind: 'ok', text: t('Candidate draft saved.', '候选草稿已保存。') });
    } catch (error) {
      setFeedback({ kind: 'err', text: formatApiError(error) });
    }
  }

  const handlePublish = async () => {
    if (!activeCandidate) return;
    setFeedback(null);
    if (!formVendorId || !formTitle.trim() || !formEventDate || !formPrimaryUrl.trim()) {
      setFeedback({
        kind: 'err',
        text: t(
          'Vendor, title, date, and official primary reference URL are required before publishing.',
          '发布前必须填写厂商、标题、日期与官方主证据链接。',
        ),
      });
      return;
    }
    try {
      const res = await mutations.publish.mutateAsync({
        id: activeCandidate.id,
        body: {
          expectedRevision: editingRevision,
          vendorId: formVendorId,
          modelId: activeCandidate.modelId ?? null,
          eventType: formEventType,
          eventStatus: formEventStatus,
          title: formTitle.trim(),
          eventDate: formEventDate,
          datePrecision: formDatePrecision,
          summaryZh: formSummaryZh.trim() || null,
          summaryEn: formSummaryEn.trim() || null,
          primaryReferenceUrl: formPrimaryUrl.trim(),
          primaryReferenceTitle: formTitle.trim(),
          sourceTier: 'official',
        },
      });
      setActiveId(null);
      setFeedback({
        kind: 'ok',
        text: t(`Published event ${res.eventId}. Visible on /ai immediately.`, `已发布事件 ${res.eventId}，现已在 /ai 公开展示。`),
      });
    } catch (e) {
      setFeedback({ kind: 'err', text: formatApiError(e) });
    }
  };

  const handleReject = async (status: 'rejected' | 'deferred') => {
    if (!activeCandidate) return;
    setFeedback(null);
    try {
      await mutations.reject.mutateAsync({
        id: activeCandidate.id,
        expectedRevision: editingRevision,
        status,
        reviewerNote: formNote.trim() || undefined,
      });
      setActiveId(null);
      setFeedback({
        kind: 'ok',
        text: status === 'rejected' ? t('Candidate rejected.', '已驳回候选。') : t('Candidate dismissed.', '已忽略候选。'),
      });
    } catch (e) {
      setFeedback({ kind: 'err', text: formatApiError(e) });
    }
  };

  return (
    <div className="ds-page collection-page">
      <div className="crumb">
        <button type="button" onClick={() => onNavigate('/sources?tab=sources&domain=research')}>
          {t('Operations Admin', '运维管理')}
        </button>
        <span>/</span>
        <b>{t('AI Release Review', 'AI 发布审核队列')}</b>
      </div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {t('AI Release Review Queue', 'AI 发布审核与台账队列')}
          </h1>
          <p className="page-desc">
            {t(
              'Verify registry diffs against official primary evidence before publishing to /ai.',
              '所有注册表变更候选必须核验官方一手链接与日期精度后，方可发布到公开 /ai 页面。',
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`ds-btn ${tab === 'ops' ? '' : 'ds-btn--ghost'}`}
            aria-pressed={tab === 'ops'}
            onClick={() => setTab('ops')}
          >
            {t('Automation & Ops', '自动化与运维')}
          </button>
          <button
            type="button"
            className={`ds-btn ${tab === 'queue' ? '' : 'ds-btn--ghost'}`}
            aria-pressed={tab === 'queue'}
            onClick={() => setTab('queue')}
          >
            {t('Exception Queue', '异常审核队列')}
          </button>
          <button
            type="button"
            className={`ds-btn ${tab === 'published' ? '' : 'ds-btn--ghost'}`}
            aria-pressed={tab === 'published'}
            onClick={() => setTab('published')}
          >
            {t('Published Events', '已发布事件')}
          </button>
          <button
            type="button"
            className={`ds-btn ${tab === 'sources' ? '' : 'ds-btn--ghost'}`}
            aria-pressed={tab === 'sources'}
            onClick={() => setTab('sources')}
          >
            {t('Sources & Registry', '官方来源与注册表')}
          </button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate('/ai')}>
            <ExternalLink size={14} /> {t('View /ai', '查看 /ai')}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.kind === 'err' ? 'alert' : 'status'}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            marginBottom: 14,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: feedback.kind === 'ok' ? 'rgba(0, 159, 129, 0.10)' : 'rgba(220, 38, 38, 0.10)',
            color: feedback.kind === 'ok' ? '#047857' : '#b91c1c',
            border: `1px solid ${feedback.kind === 'ok' ? 'rgba(0, 159, 129, 0.25)' : 'rgba(220, 38, 38, 0.25)'}`,
          }}
        >
          {feedback.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          <span>{feedback.text}</span>
        </div>
      )}
      {pendingMfaAction && (
        <div style={{ marginBottom: 14 }}>
          <InlineMfaStepUp
            onVerified={async () => {
              await pendingMfaAction();
              setPendingMfaAction(null);
            }}
            onCancel={() => setPendingMfaAction(null)}
          />
        </div>
      )}

      {tab === 'ops' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ds-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>{t('7-Day Automation Summary', '近 7 天自动化运行摘要')}</h2>

              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  disabled={mutations.runDiscovery.isPending}
                  onClick={() => { void runDiscovery(true); }}
                >
                  {t('Run Shadow Eval', '执行影子评估')}
                </button>
                <button
                  type="button"
                  className="ds-btn"
                  disabled={mutations.runDiscovery.isPending}
                  onClick={() => { void runDiscovery(false); }}
                >
                  <RefreshCw size={14} /> {t('Run Auto Discovery', '立即执行官方发现')}
                </button>
              </div>
            </div>

            {opsSummaryQ.data && (
              <dl className="collection-source-facts collection-ai-state">
                <div><dt>{t('AI scheduler', 'AI 调度')}</dt><dd>{opsSummaryQ.data.schedulerConfigured ? t('Enabled', '已启用') : t('Disabled', '已关闭')}</dd></div>
                <div><dt>{t('Source networking', '普通采集联网')}</dt><dd>{opsSummaryQ.data.sourceNetworkingConfigured ? t('Enabled', '已启用') : t('Disabled', '已关闭')}</dd></div>
                <div><dt>{t('Discovery mode', '发现模式')}</dt><dd>{opsSummaryQ.data.shadowMode ? t('Shadow evaluation', '影子评估') : t('Vendor policy', '按厂商发布策略')}</dd></div>
                <div><dt>{t('Collection worker', '采集 Worker')}</dt><dd>{opsSummaryQ.data.collectionWorker?.heartbeatFresh ? opsSummaryQ.data.collectionWorker.state : t('Heartbeat unavailable', '心跳缺失或陈旧')}</dd></div>
                <div><dt>{t('LLM reservation (UTC day)', 'LLM 预留（UTC 日）')}</dt><dd>{opsSummaryQ.data.llmConfigured ? t('Configured', '已配置') : t('Rule-only', '仅规则匹配')} · {opsSummaryQ.data.llmBudget.reservedToday}/{opsSummaryQ.data.llmBudget.dailyLimit}</dd></div>
                <div><dt>Artificial Analysis</dt><dd>{opsSummaryQ.data.aaKeyConfigured ? t('Key configured', '凭证已配置') : t('Key missing', '凭证未配置')} · {opsSummaryQ.data.aaPublicRedistribution ? t('Public redistribution configured', '已配置公开分发') : t('Internal only', '仅内部使用')}</dd></div>
              </dl>
            )}
            {opsSummaryQ.error && <div role="alert" className="wb-alert wb-alert--error">{formatApiError(opsSummaryQ.error)}</div>}
            <p className="collection-hint">{t('Discovery scans stored content from qualifying sources and verifies official URLs. Use Sources & Registry to check upstream collection and vendor bindings.', '发现扫描符合来源条件的入库内容并核验官方链接。可在「官方来源与注册表」检查上游采集与厂商关联。')}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                { label: t('Auto-Published', '自动发布'), val: opsSummaryQ.data?.metrics.autoPublished ?? 0 },
                { label: t('Shadow Passed', '影子通过'), val: opsSummaryQ.data?.metrics.shadowPassed ?? 0 },
                { label: t('Needs Info / Rejected', '缺证据拦截'), val: opsSummaryQ.data?.metrics.shadowRejected ?? 0 },
                { label: t('Low-Value Archived', '低价值自动归档'), val: opsSummaryQ.data?.metrics.lowValueArchived ?? 0 },
                { label: t('Rolled Back', '已撤回/纠错'), val: opsSummaryQ.data?.metrics.rolledBack ?? 0 },
              ].map((m) => (
                <div key={m.label} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--paper)' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{m.val}</div>
                </div>
              ))}
            </div>
          </div>

          {(opsSummaryQ.data?.openAlerts ?? []).length > 0 && (
            <div className="ds-card" style={{ padding: 16 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>{t('Open Ops Alerts', '未关闭故障告警')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {opsSummaryQ.data!.openAlerts.map((a) => (
                  <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(220,38,38,0.25)', background: 'rgba(220,38,38,0.05)' }}>
                    <div style={{ fontSize: 13 }}>
                      <strong>[{a.severity}]</strong> {a.sourceCode ? `${a.sourceCode}: ` : ''}{a.message}
                    </div>
                    <button
                      type="button"
                      className="ds-btn ds-btn--ghost"
                      disabled={mutations.resolveAlert.isPending}
                      onClick={() => void runWithMfa(async () => {
                        await mutations.resolveAlert.mutateAsync(a.id);
                        setFeedback({ kind: 'ok', text: t('Alert resolved.', '故障告警已关闭。') });
                      })}
                    >
                      {t('Resolve', '标记已处理')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="collection-ai-grid">
            <div className="ds-card" style={{ padding: 16 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>{t('Per-Vendor Auto-Publish Rollout', '分厂商自动发布灰度开关')}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(opsSummaryQ.data?.vendors ?? []).map((v) => (
                  <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{v.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{(v.officialDomains ?? []).join(', ')}</div>
                    </div>
                    <button
                      type="button"
                      className={`ds-btn ${v.autoPublishEnabled ? '' : 'ds-btn--ghost'}`}
                      disabled={mutations.setVendorAutoPublish.isPending}
                      onClick={() => void runWithMfa(async () => {
                        await mutations.setVendorAutoPublish.mutateAsync({ id: v.id, enabled: !v.autoPublishEnabled });
                        setFeedback({
                          kind: 'ok',
                          text: t(`Auto-publish updated for ${v.name}.`, `${v.name} 自动发布策略已更新。`),
                        });
                      })}
                    >
                      {v.autoPublishEnabled ? t('Auto ON', '已开启自动') : t('Shadow Only', '仅影子评估')}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="ds-card" style={{ padding: 16 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>{t('Auto-Publish & Rollback Audit', '自动发布与撤回审计记录')}</h3>
              {(opsAuditQ.data?.items ?? []).length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>{t('No automation audit records yet.', '暂无自动化审计记录。')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
                  {(opsAuditQ.data?.items ?? []).map((item) => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 12.5 }}>
                      <div>
                        <strong>{item.mode}</strong> · {item.vendorName || '—'} · <span>{item.ruleName}</span>
                        {item.reason && <div style={{ color: 'var(--muted)', marginTop: 2 }}>{item.reason}</div>}
                      </div>
                      {item.mode === 'auto_publish' && item.eventId && (
                        <button
                          type="button"
                          className="ds-btn ds-btn--ghost"
                          disabled={mutations.rollback.isPending}
                          onClick={() => void runWithMfa(async () => {
                            await mutations.rollback.mutateAsync({ id: item.eventId!, reason: 'Admin rollback from ops audit' });
                            setFeedback({ kind: 'ok', text: t('Published event rolled back.', '已撤回该自动发布事件。') });
                          })}
                        >
                          {t('Rollback', '一键撤回')}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(adminRankingsQ.data?.items ?? []).length > 0 && (
            <div className="ds-card" style={{ padding: 16 }}>
              <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>
                {t('Internal Benchmark Snapshots (Admin Preview)', '已同步外部评测快照（内部管理预览）')}
              </h3>
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--muted)' }}>
                {t('Free-tier Artificial Analysis snapshots are restricted to internal admin inspection unless commercial public redistribution is enabled.', '免费层 Artificial Analysis 快照仅限内部管理台查看，未获商业授权前不向公开页面分发。')}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                {adminRankingsQ.data!.items.map((snap) => (
                  <div key={snap.id} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{snap.metricName}</div>
                    {snap.entries.slice(0, 5).map((e) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
                        <span>#{e.rank} {e.modelName}</span>
                        <strong>{e.score.toFixed(1)} {snap.unit ?? ''}</strong>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'queue' && (
        <div className="collection-ai-grid">
          <div className="ds-card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <select
                aria-label={t('Filter by status', '按状态筛选')}
                className="ds-input"
                style={{ width: 'auto', minWidth: 160 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="pending">{t('Pending', '待审核')}</option>
                <option value="needs_info">{t('Needs Official Evidence', '缺官方证据')}</option>
                <option value="approved">{t('Approved', '已通过')}</option>
                <option value="rejected">{t('Rejected', '已驳回')}</option>
                <option value="deferred">{t('Deferred', '已搁置')}</option>
                <option value="">{t('All Statuses', '全部状态')}</option>
              </select>

              <select
                aria-label={t('Filter by vendor', '按厂商筛选')}
                className="ds-input"
                style={{ width: 'auto', minWidth: 150 }}
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value)}
              >
                <option value="">{t('All Vendors', '全部厂商')}</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.slug}>{v.name}</option>
                ))}
              </select>

              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  onClick={handleBulkDismiss}
                  disabled={mutations.bulkDismiss.isPending}
                >
                  <Trash2 size={14} /> {t(`Dismiss (${selectedIds.size})`, `批量忽略 (${selectedIds.size})`)}
                </button>
              )}
            </div>

            {queueQ.isLoading ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('Loading queue...', '加载审核队列...')}</p>
            ) : candidates.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
                {t('No candidates in this queue filter.', '当前筛选条件下暂无候选事件。')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {candidates.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: `1px solid ${activeId === c.id ? 'var(--ink)' : 'var(--line)'}`,
                      background: activeId === c.id ? 'rgba(0, 159, 129, 0.05)' : 'var(--surface)',
                      cursor: 'pointer',
                    }}
                    onClick={() => selectCandidate(c)}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${c.title}`}
                      checked={selectedIds.has(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleChecked(c.id)}
                      style={{ marginTop: 4 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--opal-soft)', color: 'var(--ink)' }}>
                          {c.vendorName || t('Unmapped vendor', '未映射厂商')}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.suggestedEventType}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{c.status} · rev {c.revision}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{c.title}</div>
                      {c.evidenceSummary && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{c.evidenceSummary}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="ds-card" style={{ padding: 18 }}>
            {!activeCandidate ? (
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                {t('Select a candidate from the left list to inspect evidence, edit fields, or publish.', '请从左侧选择一条候选事件，核验官方证据后执行发布或驳回。')}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t('Review & Publish Gate', '审核与发布门控')}</h3>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>rev {activeCandidate.revision}</span>
                </div>

                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('Vendor *', '厂商 *')}
                  <select className="ds-input" value={formVendorId} onChange={(e) => setFormVendorId(e.target.value)}>
                    <option value="">—</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </label>

                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('Event Title *', '事件标题 *')}
                  <input className="ds-input" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>
                    {t('Event Type *', '事件类型 *')}
                    <select className="ds-input" value={formEventType} onChange={(e) => setFormEventType(e.target.value)}>
                      {EVENT_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>
                    {t('Release Status *', '发布状态 *')}
                    <select
                      className="ds-input"
                      value={formEventStatus}
                      onChange={(e) => setFormEventStatus(e.target.value as 'released' | 'announced_future' | 'deprecated' | 'retired')}
                    >
                      <option value="released">released</option>
                      <option value="announced_future">announced_future</option>
                      <option value="deprecated">deprecated</option>
                      <option value="retired">retired</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>
                    {t('Official Date *', '官方日期 *')}
                    <input className="ds-input" type="date" value={formEventDate} onChange={(e) => setFormEventDate(e.target.value)} />
                  </label>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>
                    {t('Date Precision *', '日期精度 *')}
                    <select
                      className="ds-input"
                      value={formDatePrecision}
                      onChange={(e) => setFormDatePrecision(e.target.value as 'day' | 'month')}
                    >
                      <option value="day">day</option>
                      <option value="month">month</option>
                    </select>
                  </label>
                </div>

                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('Primary Official Evidence URL *', '官方主证据链接 *')}
                  <input
                    className="ds-input"
                    type="url"
                    placeholder="https://..."
                    value={formPrimaryUrl}
                    onChange={(e) => setFormPrimaryUrl(e.target.value)}
                  />
                </label>

                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('Summary (ZH)', '中文摘要')}
                  <textarea className="ds-input" rows={2} value={formSummaryZh} onChange={(e) => setFormSummaryZh(e.target.value)} />
                </label>

                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('Summary (EN)', '英文摘要')}
                  <textarea className="ds-input" rows={2} value={formSummaryEn} onChange={(e) => setFormSummaryEn(e.target.value)} />
                </label>

                <label style={{ fontSize: 12, fontWeight: 600 }}>
                  {t('Reviewer Note', '审核备注')}
                  <input className="ds-input" value={formNote} onChange={(e) => setFormNote(e.target.value)} />
                </label>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                  <button type="button" className="ds-btn ds-btn--ghost" onClick={saveCandidateDraft} disabled={mutations.patch.isPending || !formTitle.trim()}>
                    {t('Save draft', '保存草稿')}
                  </button>
                  <button
                    type="button"
                    className="ds-btn"
                    onClick={handlePublish}
                    disabled={mutations.publish.isPending}
                  >
                    <CheckCircle2 size={14} /> {t('Publish to /ai', '发布到 /ai')}
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    onClick={() => handleReject('rejected')}
                    disabled={mutations.reject.isPending}
                  >
                    {t('Reject', '驳回')}
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    onClick={() => handleReject('deferred')}
                    disabled={mutations.reject.isPending}
                  >
                    {t('Defer', '搁置')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'published' && <AiEventsAdminPanel vendors={vendors} />}

      {tab === 'sources' && <AiSourceOperations vendors={vendors} onDiscovery={() => setTab('ops')} onNavigate={onNavigate} />}
    </div>
  );
}
