import { useMemo, useState } from 'react';
import { Calendar, RotateCcw, Search } from 'lucide-react';
import type { AiReleaseEventItem, AiVendorItem } from '../../api/ai-client';
import { useI18n } from '../../i18n/translations';
import { AiVendorLogo } from './AiVendorLogo';

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

interface TimeBucket {
  key: string;
  label: string;
  subLabel?: string;
  startIso: string;
  endIso: string;
  isCurrent: boolean;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildTimeBuckets(zoom: TimelineZoom, anchor: Date, todayIso: string): TimeBucket[] {
  const y = anchor.getUTCFullYear();
  const m = anchor.getUTCMonth();
  const buckets: TimeBucket[] = [];

  if (zoom === 'week') {
    for (let w = -3; w <= 0; w++) {
      const start = new Date(Date.UTC(y, m, anchor.getUTCDate() + w * 7 - 6));
      const end = new Date(Date.UTC(y, m, anchor.getUTCDate() + w * 7));
      const startIso = toIsoDate(start);
      const endIso = toIsoDate(end);
      buckets.push({
        key: `${startIso}_${endIso}`,
        label: `${startIso.slice(5)} ~ ${endIso.slice(5)}`,
        startIso,
        endIso,
        isCurrent: todayIso >= startIso && todayIso <= endIso,
      });
    }
    return buckets;
  }

  const monthOffsets =
    zoom === 'month' ? [-2, -1, 0] :
    zoom === '6m' ? [-5, -4, -3, -2, -1, 0] :
    zoom === '12m' ? Array.from({ length: 12 }, (_, i) => i - 11) :
    Array.from({ length: 12 }, (_, i) => i - m);

  for (const offset of monthOffsets) {
    const start = new Date(Date.UTC(y, m + offset, 1));
    const end = new Date(Date.UTC(y, m + offset + 1, 0));
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(end);
    const yr = start.getUTCFullYear();
    const mo = start.getUTCMonth();
    buckets.push({
      key: `${yr}-${String(mo + 1).padStart(2, '0')}`,
      label: MONTH_SHORT[mo],
      subLabel: mo === 0 || offset === monthOffsets[0] ? String(yr) : undefined,
      startIso,
      endIso,
      isCurrent: todayIso >= startIso && todayIso <= endIso,
    });
  }
  return buckets;
}

function compactEventLabel(ev: AiReleaseEventItem): string {
  if (ev.modelName && ev.modelName.trim().length > 0) {
    if (ev.eventType === 'retirement') return `${ev.modelName} (Retired)`;
    if (ev.eventType === 'deprecation') return `${ev.modelName} (Deprecated)`;
    return ev.modelName;
  }
  return ev.title;
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
  const [todayIso] = useState<string>(() => toIsoDate(new Date()));
  const [hovered, setHovered] = useState<{ ev: AiReleaseEventItem; x: number; y: number } | null>(null);

  const buckets = useMemo(() => buildTimeBuckets(zoom, anchor, todayIso), [zoom, anchor, todayIso]);

  const visibleVendors = useMemo(() => {
    if (!selectedVendor) return vendors;
    return vendors.filter((v) => v.slug === selectedVendor);
  }, [vendors, selectedVendor]);

  const windowStartIso = buckets[0]?.startIso ?? '1970-01-01';
  const windowEndIso = buckets[buckets.length - 1]?.endIso ?? '2999-12-31';

  const eventsByVendorAndBucket = useMemo(() => {
    const map = new Map<string, AiReleaseEventItem[]>();
    for (const ev of events) {
      if (ev.eventDate < windowStartIso || ev.eventDate > windowEndIso) continue;
      const bucket = buckets.find((b) => ev.eventDate >= b.startIso && ev.eventDate <= b.endIso);
      if (!bucket) continue;
      const key = `${ev.vendorSlug}::${bucket.key}`;
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.title.localeCompare(b.title));
    }
    return map;
  }, [events, buckets, windowStartIso, windowEndIso]);

  const vendorCountsInWindow = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [k, list] of eventsByVendorAndBucket.entries()) {
      const slug = k.split('::')[0];
      counts.set(slug, (counts.get(slug) ?? 0) + list.length);
    }
    return counts;
  }, [eventsByVendorAndBucket]);

  const totalVisibleInWindow = useMemo(
    () => Array.from(vendorCountsInWindow.values()).reduce((sum, n) => sum + n, 0),
    [vendorCountsInWindow],
  );

  const colMinWidth = zoom === 'week' ? 180 : zoom === 'month' ? 210 : 148;
  const gridTrackColumns = `184px repeat(${buckets.length}, minmax(${colMinWidth}px, 1fr))`;

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
          <div className="ai-timeline-toolbar__group">
            <div className="ai-zoom-segmented" role="group" aria-label={t('Time range', '时间缩放')}>
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
            </div>
            <button
              type="button"
              className="ai-dark-btn ai-today-reset-btn"
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

            <div className="ai-search-wrap">
              <Search size={13} className="ai-search-icon" />
              <input
                type="search"
                className="ai-dark-input"
                placeholder={t('Search model/event...', '搜索模型或事件...')}
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="ai-timeline-legend">
          <div className="ai-timeline-legend__items">
            <span>
              <i className="ai-legend-dot is-released" />
              {t('Verified Released', '官方已发布')}
            </span>
            <span>
              <i className="ai-legend-dot is-future" />
              {t('Announced (Upcoming)', '官宣待发布')}
            </span>
            <span>
              <i className="ai-legend-dot is-today" />
              {t('Current Period', '当前周期')}
            </span>
            <span>{t('~ = Month precision (exact day unconfirmed)', '~ = 仅精确到月（日期待官宣）')}</span>
          </div>
          <span className="ai-timeline-count">
            {t(`${totalVisibleInWindow} events in window`, `当前时间窗共 ${totalVisibleInWindow} 条已核验事件`)}
          </span>
        </div>

        {loading ? (
          <div className="ai-timeline-empty">
            {t('Loading verified AI release timeline...', '正在加载官方已核验 AI 发布时间轴...')}
          </div>
        ) : events.length === 0 ? (
          <div className="ai-timeline-empty">
            <Calendar size={26} style={{ marginBottom: 10, opacity: 0.6, color: '#009f81' }} />
            <div className="ai-timeline-empty__title">
              {t('No verified release events match the current filter', '当前筛选条件下暂无已核验发布事件')}
            </div>
            <p className="ai-timeline-empty__desc">
              {t(
                'SIFTLINE only displays release events verified against official announcements or primary changelogs. Try widening the filter or check the official updates stream below.',
                'SIFTLINE 仅展示经官方一手来源核验的发布事件，不展示未经核实的传闻或占位数据。可尝试放宽筛选或查看下方官方动态。',
              )}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Horizontal Vendor x Time-Bucket Matrix */}
            <div className="ai-timeline-scroll">
              <div className="ai-timeline-grid" style={{ minWidth: `${184 + buckets.length * colMinWidth}px` }}>
                <div className="ai-timeline-header-row" style={{ gridTemplateColumns: gridTrackColumns }}>
                  <div className="ai-timeline-vendor-col">{t('Vendor', '厂商')}</div>
                  {buckets.map((b) => (
                    <div key={b.key} className={`ai-timeline-month-cell ${b.isCurrent ? 'is-current' : ''}`}>
                      <span>{b.label}</span>
                      {b.subLabel && <span className="ai-month-year">{b.subLabel}</span>}
                      {b.isCurrent && <span className="ai-current-pill">{t('Now', '当前')}</span>}
                    </div>
                  ))}
                </div>

                {visibleVendors.map((v) => {
                  const rowCount = vendorCountsInWindow.get(v.slug) ?? 0;
                  const brandColor = v.brandColor || '#009f81';
                  return (
                    <div key={v.id} className="ai-timeline-row" style={{ gridTemplateColumns: gridTrackColumns }}>
                      <div className="ai-timeline-vendor-col">
                        <span className="ai-vendor-identity">
                          <span className="ai-vendor-logo-badge" style={{ color: brandColor }}>
                            <AiVendorLogo slug={v.slug} size={18} color={brandColor} />
                          </span>
                          <span className="ai-vendor-name">{v.name}</span>
                        </span>
                        <span className="ai-vendor-count">{rowCount}</span>
                      </div>
                      {buckets.map((b) => {
                        const cellEvents = eventsByVendorAndBucket.get(`${v.slug}::${b.key}`) ?? [];
                        return (
                          <div key={b.key} className={`ai-timeline-cell ${b.isCurrent ? 'is-current' : ''}`}>
                            {cellEvents.map((ev) => (
                              <button
                                key={ev.id}
                                type="button"
                                className={`ai-event-chip ${ev.eventStatus === 'announced_future' ? 'is-future' : ''} ${ev.datePrecision === 'month' ? 'is-month-precision' : ''}`}
                                onClick={() => onSelectEvent(ev.id)}
                                onMouseEnter={(e) => setHovered({ ev, x: e.clientX, y: e.clientY })}
                                onMouseMove={(e) => setHovered({ ev, x: e.clientX, y: e.clientY })}
                                onMouseLeave={() => setHovered(null)}
                                onFocus={(e) => {
                                  const r = e.currentTarget.getBoundingClientRect();
                                  setHovered({ ev, x: r.left, y: r.bottom });
                                }}
                                onBlur={() => setHovered(null)}
                                title={ev.title}
                              >
                                <AiVendorLogo slug={v.slug} size={13} color={brandColor} />
                                <span className="ai-event-chip__text">{compactEventLabel(ev)}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
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
                  <div className="ai-mobile-event-card__meta">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <AiVendorLogo slug={ev.vendorSlug} size={14} />
                      <span>{ev.vendorName} · {ev.eventType}</span>
                    </span>
                    <span>{ev.datePrecision === 'month' ? `${ev.eventDate.slice(0, 7)} (~)` : ev.eventDate}</span>
                  </div>
                  <div className="ai-mobile-event-card__title">{ev.title}</div>
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
          <div className="ai-hover-popover__meta">
            <AiVendorLogo slug={hovered.ev.vendorSlug} size={13} />
            <span>
              {hovered.ev.vendorName} · {hovered.ev.datePrecision === 'month' ? `${hovered.ev.eventDate.slice(0, 7)} (~)` : hovered.ev.eventDate}
            </span>
          </div>
          <div className="ai-hover-popover__title">{hovered.ev.title}</div>
          {(hovered.ev.summaryZh || hovered.ev.summaryEn) && (
            <div className="ai-hover-popover__summary">
              {(hovered.ev.summaryZh || hovered.ev.summaryEn || '').slice(0, 140)}
            </div>
          )}
          <div className="ai-hover-popover__cta">
            {t('Click to inspect official evidence & specs →', '点击查看官方主证据与规格变动 →')}
          </div>
        </div>
      )}
    </section>
  );
}
