import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  EyeOff,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import {
  type AiCandidateItem,
  useAiAdminMutations,
  useAiAdminRankingsQuery,
  useAiEventsQuery,
  useAiOpsAuditQuery,
  useAiOpsSummaryQuery,
  useAiQueueQuery,
  useAiSourcesQuery,
  useAiVendorsQuery,
} from '../api/ai-client';
import { formatApiError } from '../api/hooks';
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
  const isAdmin = actor.role === 'owner' || actor.role === 'admin';

  const [tab, setTab] = useState<'ops' | 'queue' | 'published' | 'sources'>('ops');
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [vendorFilter, setVendorFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
  const eventsQ = useAiEventsQuery({ limit: 60 }, isAdmin && tab === 'published');
  const sourcesQ = useAiSourcesQuery(isAdmin && tab === 'sources');
  const mutations = useAiAdminMutations();

  const vendors = vendorsQ.data?.items ?? [];
  const candidates = useMemo(() => queueQ.data?.items ?? [], [queueQ.data?.items]);
  const activeCandidate = useMemo(
    () => candidates.find((c) => c.id === activeId) ?? null,
    [candidates, activeId],
  );

  const selectCandidate = (c: AiCandidateItem) => {
    setActiveId(c.id);
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
          expectedRevision: activeCandidate.revision,
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
        expectedRevision: activeCandidate.revision,
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

  const handleUnpublish = async (eventId: string) => {
    setFeedback(null);
    try {
      await mutations.unpublish.mutateAsync({ id: eventId, reason: 'Unpublished from admin queue' });
      setFeedback({ kind: 'ok', text: t('Event unpublished and removed from public /ai.', '事件已撤回，已立即从公开 /ai 隐藏。') });
    } catch (e) {
      setFeedback({ kind: 'err', text: formatApiError(e) });
    }
  };

  return (
    <div style={{ padding: '20px 24px 40px', maxWidth: 1360, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>
            {t('AI Release Review Queue', 'AI 发布审核与台账队列')}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
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
            onClick={() => setTab('ops')}
          >
            {t('Automation & Ops', '自动化与运维')}
          </button>
          <button
            type="button"
            className={`ds-btn ${tab === 'queue' ? '' : 'ds-btn--ghost'}`}
            onClick={() => setTab('queue')}
          >
            {t('Exception Queue', '异常审核队列')}
          </button>
          <button
            type="button"
            className={`ds-btn ${tab === 'published' ? '' : 'ds-btn--ghost'}`}
            onClick={() => setTab('published')}
          >
            {t('Published Events', '已发布事件')}
          </button>
          <button
            type="button"
            className={`ds-btn ${tab === 'sources' ? '' : 'ds-btn--ghost'}`}
            onClick={() => setTab('sources')}
          >
            {t('Registry Sources', '注册表数据源')}
          </button>
          <button type="button" className="ds-btn ds-btn--ghost" onClick={() => onNavigate('/ai')}>
            <ExternalLink size={14} /> {t('View /ai', '查看 /ai')}
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
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

      {tab === 'ops' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="ds-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>{t('7-Day Automation Summary', '近 7 天自动化运行摘要')}</h2>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t('Shadow Mode', '影子模式')}: {opsSummaryQ.data?.shadowMode ? 'ON' : 'OFF'} · LLM: {opsSummaryQ.data?.llmConfigured ? 'ON' : 'Rule-Only'} · AA Public: {opsSummaryQ.data?.aaPublicRedistribution ? 'Commercial' : 'Internal Only'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  disabled={mutations.runDiscovery.isPending}
                  onClick={async () => {
                    const r = await mutations.runDiscovery.mutateAsync({ shadowMode: true, archiveLowValue: true });
                    setFeedback({ kind: 'ok', text: `Shadow run: scanned=${r.scanned}, shadowPassed=${r.shadowPassed}, queued=${r.candidatesQueued}, archived=${r.archived}` });
                  }}
                >
                  {t('Run Shadow Eval', '执行影子评估')}
                </button>
                <button
                  type="button"
                  className="ds-btn"
                  disabled={mutations.runDiscovery.isPending}
                  onClick={async () => {
                    const r = await mutations.runDiscovery.mutateAsync({ shadowMode: false, archiveLowValue: true });
                    setFeedback({ kind: 'ok', text: `Discovery run: scanned=${r.scanned}, autoPublished=${r.autoPublished}, shadowPassed=${r.shadowPassed}, archived=${r.archived}` });
                  }}
                >
                  <RefreshCw size={14} /> {t('Run Auto Discovery', '立即执行官方发现')}
                </button>
              </div>
            </div>

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
                    <button type="button" className="ds-btn ds-btn--ghost" onClick={() => mutations.resolveAlert.mutate(a.id)}>
                      {t('Resolve', '标记已处理')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
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
                      onClick={() => mutations.setVendorAutoPublish.mutate({ id: v.id, enabled: !v.autoPublishEnabled })}
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
                          onClick={() => mutations.rollback.mutate({ id: item.eventId!, reason: 'Admin rollback from ops audit' })}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(340px, 0.85fr)', gap: 18, alignItems: 'start' }}>
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

      {tab === 'published' && (
        <div className="ds-card" style={{ padding: 16 }}>
          {(eventsQ.data?.items ?? []).length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('No published events yet.', '暂无已发布事件。')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(eventsQ.data?.items ?? []).map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {ev.vendorName} · {ev.eventDate} ({ev.datePrecision}) · {ev.eventType}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{ev.title}</div>
                  </div>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    onClick={() => handleUnpublish(ev.id)}
                    disabled={mutations.unpublish.isPending}
                  >
                    <EyeOff size={14} /> {t('Unpublish', '撤回')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="ds-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(sourcesQ.data?.items ?? []).map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid var(--line)',
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{s.code} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>({s.kind})</span></div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.endpointUrl}</div>
                  <div style={{ fontSize: 11.5, color: s.lastError ? '#b91c1c' : 'var(--muted)' }}>
                    {s.lastSuccessAt ? `Last OK: ${s.lastSuccessAt}` : 'Never synced'} {s.lastError ? `· Error: ${s.lastError}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost"
                    onClick={() => mutations.syncSource.mutate({ code: s.code, dryRun: true })}
                    disabled={mutations.syncSource.isPending}
                  >
                    {t('Dry-Run', '试跑')}
                  </button>
                  <button
                    type="button"
                    className="ds-btn"
                    onClick={() => mutations.syncSource.mutate({ code: s.code, dryRun: false })}
                    disabled={mutations.syncSource.isPending}
                  >
                    <RefreshCw size={14} /> {t('Sync Now', '立即同步')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
