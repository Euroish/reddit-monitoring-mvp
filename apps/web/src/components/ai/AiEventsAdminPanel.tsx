import { useState } from 'react';
import { Edit3, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import {
  type AiAdminEventItem,
  type AiVendorItem,
  useAiAdminEventsQuery,
  useAiAdminMutations,
} from '../../api/ai-client';
import { formatApiError, isMfaRequiredError } from '../../api/hooks';
import { useI18n } from '../../i18n/translations';
import { InlineMfaStepUp } from '../InlineMfaStepUp';

const EVENT_TYPES = [
  'model_release', 'model_update', 'api_release', 'preview', 'ga',
  'pricing_change', 'deprecation', 'retirement', 'other',
] as const;

export function AiEventsAdminPanel({ vendors }: { vendors: AiVendorItem[] }) {
  const { t } = useI18n();
  const mutations = useAiAdminMutations();

  const [vendor, setVendor] = useState('');
  const [visibility, setVisibility] = useState<'all' | 'published' | 'unpublished' | 'corrected'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const eventsQ = useAiAdminEventsQuery(
    {
      vendor: vendor || undefined,
      visibility,
      q: search.trim() || undefined,
      limit: pageSize,
      offset: page * pageSize,
    },
    true,
  );

  const [formOpen, setFormOpen] = useState<'create' | AiAdminEventItem | null>(null);
  const [fVendorId, setFVendorId] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fType, setFType] = useState('model_release');
  const [fStatus, setFStatus] = useState<'released' | 'announced_future' | 'deprecated' | 'retired'>('released');
  const [fVisibility, setFVisibility] = useState<'published' | 'unpublished' | 'corrected'>('published');
  const [fDate, setFDate] = useState('');
  const [fPrecision, setFPrecision] = useState<'day' | 'month'>('day');
  const [fUrl, setFUrl] = useState('');
  const [fSummaryZh, setFSummaryZh] = useState('');
  const [fSummaryEn, setFSummaryEn] = useState('');
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [pendingMfa, setPendingMfa] = useState<(() => Promise<void>) | null>(null);

  const runWithMfa = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
      setPendingMfa(null);
    } catch (err) {
      if (isMfaRequiredError(err)) setPendingMfa(() => fn);
      else setMsg({ text: formatApiError(err), err: true });
    }
  };

  const openCreate = () => {
    setFormOpen('create');
    setFVendorId(vendors[0]?.id ?? '');
    setFTitle('');
    setFType('model_release');
    setFStatus('released');
    setFVisibility('published');
    setFDate(new Date().toISOString().slice(0, 10));
    setFPrecision('day');
    setFUrl('');
    setFSummaryZh('');
    setFSummaryEn('');
    setMsg(null);
  };

  const openEdit = (ev: AiAdminEventItem) => {
    setFormOpen(ev);
    setFVendorId(ev.vendorId);
    setFTitle(ev.title);
    setFType(ev.eventType);
    setFStatus(ev.eventStatus);
    setFVisibility(ev.visibility);
    setFDate(ev.eventDate);
    setFPrecision(ev.datePrecision);
    setFUrl(ev.primaryReferenceUrl ?? '');
    setFSummaryZh(ev.summaryZh ?? '');
    setFSummaryEn(ev.summaryEn ?? '');
    setMsg(null);
  };

  const totalCount = eventsQ.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="ds-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="search"
            className="ds-input"
            style={{ width: 220 }}
            placeholder={t('Search title or summary…', '搜索标题、摘要或模型…')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
          <select
            className="ds-input"
            style={{ width: 'auto', minWidth: 140 }}
            value={vendor}
            onChange={(e) => { setVendor(e.target.value); setPage(0); }}
          >
            <option value="">{t('All Vendors', '全部厂商')}</option>
            {vendors.map((v) => <option key={v.id} value={v.slug}>{v.name}</option>)}
          </select>
          <select
            className="ds-input"
            style={{ width: 'auto', minWidth: 140 }}
            value={visibility}
            onChange={(e) => { setVisibility(e.target.value as typeof visibility); setPage(0); }}
          >
            <option value="all">{t('All Visibilities', '全部可见性')}</option>
            <option value="published">{t('Published', '已发布')}</option>
            <option value="unpublished">{t('Unpublished', '已撤回')}</option>
            <option value="corrected">{t('Corrected', '已勘误发布')}</option>
          </select>
        </div>
        <button type="button" className="ds-btn" onClick={openCreate}>
          <Plus size={14} /> {t('New Release Event', '新建发布事件')}
        </button>
      </div>

      {msg && (
        <div role={msg.err ? 'alert' : 'status'} className={'wb-alert ' + (msg.err ? 'wb-alert--error' : 'wb-alert--success')}>
          {msg.text}
        </div>
      )}
      {pendingMfa && (
        <InlineMfaStepUp
          onVerified={async () => {
            await pendingMfa();
            setPendingMfa(null);
          }}
          onCancel={() => setPendingMfa(null)}
        />
      )}

      {formOpen && (
        <div style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--paper)', display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>
            {formOpen === 'create' ? t('Create AI Release Event', '新建 AI 发布事件') : t('Edit Release Event', '编辑发布事件')}
          </h3>
          <div className="wb-grid-2">
            {formOpen === 'create' && (
              <label className="wb-field">
                {t('Vendor *', '厂商 *')}
                <select className="wb-select" value={fVendorId} onChange={(e) => setFVendorId(e.target.value)}>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
            <label className="wb-field">
              {t('Title *', '标题 *')}
              <input className="wb-input" value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
            </label>
            <label className="wb-field">
              {t('Event Type', '事件类型')}
              <select className="wb-select" value={fType} onChange={(e) => setFType(e.target.value)}>
                {EVENT_TYPES.map((et) => <option key={et} value={et}>{et}</option>)}
              </select>
            </label>
            <label className="wb-field">
              {t('Release Status', '发布状态')}
              <select className="wb-select" value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)}>
                <option value="released">released</option>
                <option value="announced_future">announced_future</option>
                <option value="deprecated">deprecated</option>
                <option value="retired">retired</option>
              </select>
            </label>
            <label className="wb-field">
              {t('Event Date (YYYY-MM-DD)', '发布日期')}
              <input type="date" className="wb-input" value={fDate} onChange={(e) => setFDate(e.target.value)} />
            </label>
            <label className="wb-field">
              {t('Date Precision & Visibility', '精度与公开状态')}
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="wb-select" value={fPrecision} onChange={(e) => setFPrecision(e.target.value as 'day' | 'month')}>
                  <option value="day">day</option>
                  <option value="month">month</option>
                </select>
                <select className="wb-select" value={fVisibility} onChange={(e) => setFVisibility(e.target.value as typeof fVisibility)}>
                  <option value="published">published</option>
                  <option value="unpublished">unpublished</option>
                  {formOpen !== 'create' && <option value="corrected">corrected</option>}
                </select>
              </div>
            </label>
          </div>
          {formOpen === 'create' && (
            <label className="wb-field">
              {t('Official Reference URL (optional)', '官方参考链接（可选）')}
              <input type="url" className="wb-input" placeholder="https://..." value={fUrl} onChange={(e) => setFUrl(e.target.value)} />
            </label>
          )}
          <div className="wb-grid-2">
            <label className="wb-field">
              {t('Summary (ZH)', '中文摘要')}
              <textarea className="wb-input" rows={2} value={fSummaryZh} onChange={(e) => setFSummaryZh(e.target.value)} />
            </label>
            <label className="wb-field">
              {t('Summary (EN)', '英文摘要')}
              <textarea className="wb-input" rows={2} value={fSummaryEn} onChange={(e) => setFSummaryEn(e.target.value)} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="ds-btn"
              disabled={mutations.createEvent.isPending || mutations.updateEvent.isPending || !fTitle.trim() || !fDate}
              onClick={() => void runWithMfa(async () => {
                if (formOpen === 'create') {
                  await mutations.createEvent.mutateAsync({
                    vendorId: fVendorId,
                    title: fTitle.trim(),
                    eventType: fType,
                    eventStatus: fStatus,
                    publicationStatus: fVisibility === 'unpublished' ? 'unpublished' : 'published',
                    eventDate: fDate,
                    datePrecision: fPrecision,
                    summaryZh: fSummaryZh.trim() || null,
                    summaryEn: fSummaryEn.trim() || null,
                    primaryReferenceUrl: fUrl.trim() || null,
                  });
                  setMsg({ text: t('Release event created.', '发布事件已创建。') });
                } else {
                  await mutations.updateEvent.mutateAsync({
                    id: formOpen.id,
                    body: {
                      title: fTitle.trim(),
                      eventType: fType,
                      eventStatus: fStatus,
                      eventDate: fDate,
                      datePrecision: fPrecision,
                      visibility: fVisibility,
                      summaryZh: fSummaryZh.trim() || null,
                      summaryEn: fSummaryEn.trim() || null,
                    },
                  });
                  setMsg({ text: t('Release event updated.', '发布事件已更新。') });
                }
                setFormOpen(null);
              })}
            >
              {t('Save', '保存')}
            </button>
            <button type="button" className="ds-btn ds-btn--ghost" onClick={() => setFormOpen(null)}>
              {t('Cancel', '取消')}
            </button>
          </div>
        </div>
      )}

      {eventsQ.isError && <div role="alert" className="wb-alert wb-alert--error">{formatApiError(eventsQ.error)}</div>}
      {(eventsQ.data?.items ?? []).length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>{t('No matching release events.', '暂无匹配的发布事件。')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 240, flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {ev.vendorName} · {ev.eventDate} ({ev.datePrecision}) · {ev.eventType} ·{' '}
                  <span className={`chip-state ${ev.visibility === 'unpublished' ? 'paused' : 'active'}`}>{ev.visibility}</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{ev.title}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={() => openEdit(ev)}>
                  <Edit3 size={13} /> {t('Edit', '编辑')}
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost"
                  disabled={mutations.updateEvent.isPending || mutations.unpublish.isPending}
                  onClick={() => void runWithMfa(async () => {
                    if (ev.visibility === 'unpublished') {
                      await mutations.updateEvent.mutateAsync({ id: ev.id, body: { visibility: 'published' } });
                      setMsg({ text: t('Event republished to /ai.', '事件已重新发布到公开 /ai。') });
                    } else {
                      await mutations.unpublish.mutateAsync({ id: ev.id, reason: 'Unpublished from admin queue' });
                      setMsg({ text: t('Event unpublished from public /ai.', '事件已撤回并从公开 /ai 隐藏。') });
                    }
                  })}
                >
                  {ev.visibility === 'unpublished' ? <><Eye size={13} /> {t('Publish', '重新发布')}</> : <><EyeOff size={13} /> {t('Unpublish', '撤回')}</>}
                </button>
                <button
                  type="button"
                  className="ds-btn ds-btn--danger"
                  disabled={mutations.deleteEvent.isPending}
                  onClick={() => {
                    if (!window.confirm(t(`Delete release event "${ev.title}" permanently?`, `确认永久删除事件「${ev.title}」？`))) return;
                    void runWithMfa(async () => {
                      await mutations.deleteEvent.mutateAsync(ev.id);
                      setMsg({ text: t('Release event deleted.', '发布事件已永久删除。') });
                    });
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalCount > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
          <span>{t(`Page ${page + 1} of ${totalPages} (${totalCount} events)`, `第 ${page + 1} / ${totalPages} 页 · 共 ${totalCount} 条`)}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="ds-btn ds-btn--ghost" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              {t('Previous', '上一页')}
            </button>
            <button type="button" className="ds-btn ds-btn--ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('Next', '下一页')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
