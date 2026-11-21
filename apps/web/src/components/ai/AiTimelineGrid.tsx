import { useMemo, useState } from 'react';
import { Calendar, RotateCcw, Search } from 'lucide-react';
import type { AiReleaseEventItem, AiVendorItem } from '../../api/ai-client';
import { useI18n } from '../../i18n/translations';

export type TimelineZoom = '6m' | '12m' | 'year' | 'month' | 'week';

interface AiTimelineGridProps {
  vendors: AiVendorItem[];
  events: AiReleaseEventItem[];
  loading: boolean;
  selectedVendor: string;
  onSelectVendor: (slug: string) => void;
  selectedEventType: string;
  onSelectEventType: (t: string) => void;
  selectedStatus: string;
  onSelectStatus: (s: string) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSelectEvent: (eventId: string) => void;
}

function getWindowBounds(zoom: TimelineZoom, anchor: Date): { start: Date; end: Date; labels: string[] } {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  let start: Date;
  let end: Date;
  if (zoom === 'week') {
    start = new Date(Date.UTC(y, m, anchor.getUTCDate() - 14));
    end = new Date(Date.UTC(y, m, anchor.getUTCDate() + 14));
  } else if (zoom === 'month') {
    start = new Date(Date.UTC(y, m - 1, 1));
    end = new Date(Date.UTC(y, m + 2, 0));
  } else if (zoom === '6m') {
    start = new Date(Date.UTC(y, m - 4, 1));
    end = new Date(Date.UTC(y, m + 2, 0));
  } else if (zoom === '12m') {
    start = new Date(Date.UTC(y, m - 9, 1));
    end = new Date(Date.UTC(y, m + 3, 0));
  } else {
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y, 11, 31));
  }

  const labels: string[] = [];
  const totalMs = Math.max(1, end.getTime() - start.getTime());
  const slots = zoom === 'week' ? 4 : zoom === 'month' ? 3 : zoom === '6m' ? 6 : 12;
  for (let i = 0; i < slots; i++) {
    const dt = new Date(start.getTime() + (totalMs * i) / slots);
    labels.push(
      zoom === 'week'
        ? dt.toISOString().slice(5, 10)
        : `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`,
    );
  }
  return { start, end, labels };
}

export function AiTimelineGrid({
  vendors,
  events,
  loading,
  selectedVendor,
  onSelectVendor,
  selectedEventType,
  onSelectEventType,
  selectedStatus,
  onSelectStatus,
  searchQuery,
  onSearchQueryChange,
  onSelectEvent,
}: AiTimelineGridProps) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<TimelineZoom>('12m');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [todayMs] = useState<number>(() => Date.now());
  const [hovered, setHovered] = useState<{ ev: AiReleaseEventItem; x: number; y: number } | null>(null);

  const bounds = useMemo(() => getWindowBounds(zoom, anchor), [zoom, anchor]);
  const totalMs = Math.max(1, bounds.end.getTime() - bounds.start.getTime());

  const todayPct = useMemo(() => {
    const pct = ((todayMs - bounds.start.getTime()) / totalMs) * 100;
    return pct >= 0 && pct <= 100 ? pct : null;
  }, [todayMs, bounds.start, totalMs]);

  const visibleVendors = useMemo(() => {
    if (!selectedVendor) return vendors;
    return vendors.filter((v) => v.slug === selectedVendor);
  }, [vendors, selectedVendor]);

  const eventsByVendor = useMemo(() => {
    const map = new Map<string, AiReleaseEventItem[]>();
    for (const ev of events) {
      const list = map.get(ev.vendorSlug) ?? [];
      list.push(ev);
      map.set(ev.vendorSlug, list);
    }
    return map;
  }, [events]);

  const positionPct = (dateStr: string): number | null => {
    const ts = Date.parse(`${dateStr}T00:00:00Z`);
    if (!Number.isFinite(ts)) return null;
    const pct = ((ts - bounds.start.getTime()) / totalMs) * 100;
    if (pct < -2 || pct > 102) return null;
    return Math.max(4, Math.min(96, pct));
  };

  return (
    <section className="ai-section" id="timeline" aria-label={t('AI Release Timeline', 'AI 产品发布时间轴')}>
      <div className="ai-section__head">
        <div>
          <h2 className="ai-section__title">{t('Vendor × Time Release Matrix', '厂商 × 时间发布矩阵')}</h2>
          <p className="ai-section__sub">
            {t(
              'Every node is backed by an official announcement, changelog, or verified historical record.',
              '每个时间轴节点均来自官方公告、更新日志或可核验历史档案，绝不虚构发布日期。',
            )}
          </p>
        </div>
      </div>

      <div className="ai-timeline-shell">
        <div className="ai-timeline-toolbar">
          <div className="ai-timeline-toolbar__group" role="group" aria-label={t('Time range', '时间缩放')}>
            {(['week', 'month', '6m', '12m', 'year'] as TimelineZoom[]).map((z) => (
              <button
                key={z}
                type="button"
                className={`ai-dark-btn ${zoom === z ? 'is-active' : ''}`}
                onClick={() => setZoom(z)}
              >
                {z === 'week' ? t('Week', '周') : z === 'month' ? t('Month', '月') : z === '6m' ? '6M' : z === '12m' ? '12M' : t('Year', '全年')}
              </button>
            ))}
            <button
              type="button"
              className="ai-dark-btn"
              onClick={() => setAnchor(new Date())}
              title={t('Reset to today', '回到今天')}
            >
              <RotateCcw size={12} /> {t('Today', '回到今天')}
            </button>
          </div>

          <div className="ai-timeline-toolbar__group">
            <select
              aria-label={t('Vendor filter', '筛选厂商')}
              className="ai-dark-select"
              value={selectedVendor}
              onChange={(e) => onSelectVendor(e.target.value)}
            >
              <option value="">{t('All Vendors', '全部厂商')}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.slug}>{v.name}</option>
              ))}
            </select>

            <select
              aria-label={t('Event type filter', '筛选事件类型')}
              className="ai-dark-select"
              value={selectedEventType}
              onChange={(e) => onSelectEventType(e.target.value)}
            >
              <option value="">{t('All Types', '全部类型')}</option>
              <option value="model_release">{t('Model Release', '新模型发布')}</option>
              <option value="model_update">{t('Model Update', '模型更新')}</option>
              <option value="api_release">{t('API / GA', 'API / 开放')}</option>
              <option value="pricing_change">{t('Pricing Change', '价格调整')}</option>
              <option value="deprecation">{t('Deprecation', '弃用/下线')}</option>
            </select>

            <select
              aria-label={t('Status filter', '筛选发布状态')}
              className="ai-dark-select"
              value={selectedStatus}
              onChange={(e) => onSelectStatus(e.target.value)}
            >
              <option value="">{t('All Statuses', '全部状态')}</option>
              <option value="released">{t('Released', '已发布')}</option>
              <option value="announced_future">{t('Announced (Upcoming)', '已官宣待发布')}</option>
              <option value="deprecated">{t('Deprecated', '已弃用')}</option>
            </select>

            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, color: '#9cb5ae', pointerEvents: 'none' }} />
              <input
                type="search"
                className="ai-dark-input"
                style={{ paddingLeft: 28, width: 170 }}
                placeholder={t('Search model/event...', '搜索模型或事件...')}
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="ai-timeline-legend">
          <span>
            <i className="ai-legend-dot" style={{ background: '#009f81', border: '1px solid #9df264' }} />
            {t('Verified Released', '官方已发布')}
          </span>
          <span>
            <i className="ai-legend-dot" style={{ background: 'transparent', border: '1px dashed #cbd5e1' }} />
            {t('Announced (Upcoming)', '官宣待发布')}
          </span>
          <span>
            <i className="ai-legend-dot" style={{ background: '#9df264' }} />
            {t('Today Marker', '今日基准线')}
          </span>
          <span>{t('~ = Month precision (exact day unconfirmed)', '~ = 仅精确到月（日期待官宣）')}</span>
        </div>

        {loading ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#9cb5ae', fontSize: 13.5 }}>
            {t('Loading verified AI release timeline...', '正在加载官方已核验 AI 发布时间轴...')}
          </div>
        ) : events.length === 0 ? (
          <div style={{ padding: '42px 24px', textAlign: 'center', color: '#9cb5ae' }}>
            <Calendar size={26} style={{ marginBottom: 10, opacity: 0.7 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#edf5f2', marginBottom: 6 }}>
              {t('No verified release events match the current filter', '当前筛选条件下暂无已核验发布事件')}
            </div>
            <p style={{ margin: 0, fontSize: 13, maxWidth: 480, marginInline: 'auto' }}>
              {t(
                'SIFTLINE only displays release events verified against official announcements or primary changelogs. Try widening the filter or check the official updates stream below.',
                'SIFTLINE 仅展示经官方一手来源核验的发布事件，不展示未经核实的传闻或占位数据。可尝试放宽筛选或查看下方官方动态。',
              )}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Horizontal Vendor x Time Matrix */}
            <div className="ai-timeline-scroll">
              <div className="ai-timeline-grid">
                <div className="ai-timeline-header-row">
                  <div className="ai-timeline-vendor-col">{t('Vendor', '厂商')}</div>
                  <div
                    className="ai-timeline-months"
                    style={{ gridTemplateColumns: `repeat(${bounds.labels.length}, minmax(0, 1fr))` }}
                  >
                    {bounds.labels.map((lbl) => (
                      <div key={lbl} className="ai-timeline-month-cell">{lbl}</div>
                    ))}
                  </div>
                </div>

                {visibleVendors.map((v) => {
                  const rowEvents = eventsByVendor.get(v.slug) ?? [];
                  return (
                    <div key={v.id} className="ai-timeline-row">
                      <div className="ai-timeline-vendor-col">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
                          <span className="ai-vendor-dot" style={{ background: v.brandColor || '#009f81' }} />
                          {v.name}
                        </span>
                        <span style={{ fontSize: 11, color: '#84a29a' }}>{rowEvents.length}</span>
                      </div>
                      <div className="ai-timeline-track" style={{ minHeight: Math.max(58, 38 + Math.min(rowEvents.length, 3) * 26) }}>
                        {todayPct !== null && <div className="ai-today-line" style={{ left: `${todayPct}%` }} />}
                        {rowEvents.map((ev, idx) => {
                          const left = positionPct(ev.eventDate);
                          if (left === null) return null;
                          const lane = idx % 3;
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              className={`ai-event-chip ${ev.eventStatus === 'announced_future' ? 'is-future' : ''} ${ev.datePrecision === 'month' ? 'is-month-precision' : ''}`}
                              style={{ left: `${left}%`, top: `${10 + lane * 30}px` }}
                              onClick={() => onSelectEvent(ev.id)}
                              onMouseEnter={(e) => setHovered({ ev, x: e.clientX, y: e.clientY })}
                              onMouseMove={(e) => setHovered({ ev, x: e.clientX, y: e.clientY })}
                              onMouseLeave={() => setHovered(null)}
                              onFocus={(e) => {
                                const r = e.currentTarget.getBoundingClientRect();
                                setHovered({ ev, x: r.left, y: r.bottom });
                              }}
                              onBlur={() => setHovered(null)}
                            >
                              {ev.title}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile Stacked Timeline List */}
            <div className="ai-timeline-mobile">
              {events.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="ai-mobile-event-card"
                  onClick={() => onSelectEvent(ev.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#9cb5ae' }}>
                    <span>{ev.vendorName} · {ev.eventType}</span>
                    <span>{ev.datePrecision === 'month' ? `${ev.eventDate.slice(0, 7)} (~)` : ev.eventDate}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{ev.title}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {hovered && (
        <div
          className="ai-hover-popover"
          role="tooltip"
          style={{
            left: Math.min(window.innerWidth - 320, Math.max(12, hovered.x + 14)),
            top: Math.min(window.innerHeight - 160, Math.max(12, hovered.y + 14)),
          }}
        >
          <div style={{ fontSize: 11, color: '#9df264', fontWeight: 700, marginBottom: 4 }}>
            {hovered.ev.vendorName} · {hovered.ev.datePrecision === 'month' ? `${hovered.ev.eventDate.slice(0, 7)} (month)` : hovered.ev.eventDate}
          </div>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{hovered.ev.title}</div>
          {(hovered.ev.summaryZh || hovered.ev.summaryEn) && (
            <div style={{ color: '#c4dad3', lineHeight: 1.45 }}>
              {(hovered.ev.summaryZh || hovered.ev.summaryEn || '').slice(0, 140)}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: '#84a29a' }}>
            {t('Click to inspect official evidence & specs →', '点击查看官方主证据与规格变动 →')}
          </div>
        </div>
      )}
    </section>
  );
}
