import { Fragment } from 'react';
import type { CommunityMatrixRowDto } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';

export function MonitorTimelineSvg({
  points,
}: {
  points: Array<{ bucketAt: string; postCount: number; sumComments: number; sumScore: number; sumLikes: number }>;
}) {
  const { t } = useI18n();
  const grouped = new Map<string, { posts: number; eng: number }>();
  for (const p of points) {
    const key = p.bucketAt.slice(0, 13);
    const prev = grouped.get(key) ?? { posts: 0, eng: 0 };
    prev.posts += p.postCount;
    prev.eng += p.sumScore + p.sumLikes + 2 * p.sumComments;
    grouped.set(key, prev);
  }
  const series = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  if (series.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
        {t('No bucketed timeline observations in this window.', '当前时间窗内暂无分桶观测趋势数据。')}
      </div>
    );
  }
  const w = 640;
  const h = 150;
  const pad = 18;
  const maxPosts = Math.max(1, ...series.map(([, v]) => v.posts));
  const coords = series.map(([label, v], idx) => {
    const x = series.length === 1 ? w / 2 : pad + (idx / (series.length - 1)) * (w - pad * 2);
    const y = h - pad - (v.posts / maxPosts) * (h - pad * 2);
    return { x, y, label, posts: v.posts, eng: v.eng };
  });
  const poly = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', minWidth: 320, height: 150, display: 'block' }}>
        <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="var(--line)" strokeWidth="1" />
        <line x1={pad} y1={pad} x2={w - pad} y2={pad} stroke="var(--line)" strokeDasharray="3 3" strokeWidth="1" />
        {coords.length > 1 && (
          <polyline fill="none" stroke="var(--accent, #2563eb)" strokeWidth="2.2" points={poly} />
        )}
        {coords.map((c) => (
          <circle key={c.label} cx={c.x} cy={c.y} r="3.6" fill="var(--accent, #2563eb)">
            <title>{`${c.label}: ${c.posts} posts / ${c.eng} engagement`}</title>
          </circle>
        ))}
        <text x={pad} y={12} fontSize="10" fill="var(--muted)">max {maxPosts} posts</text>
        <text x={pad} y={h - 3} fontSize="10" fill="var(--muted)">{coords[0].label}</text>
        {coords.length > 1 && (
          <text x={w - pad} y={h - 3} textAnchor="end" fontSize="10" fill="var(--muted)">
            {coords[coords.length - 1].label}
          </text>
        )}
      </svg>
    </div>
  );
}

export function SubredditQuadrantSvg({
  items,
  selected,
  onSelect,
}: {
  items: CommunityMatrixRowDto[];
  selected: string | null;
  onSelect: (subreddit: string) => void;
}) {
  const { t } = useI18n();
  if (!items.length) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
        {t('No subreddit matrix observations yet.', '暂无 Reddit 社区样本数据。')}
      </div>
    );
  }
  const w = 520;
  const h = 210;
  const pad = 28;
  const maxPosts = Math.max(1, ...items.map((i) => i.postCount));
  const maxAvgComments = Math.max(1, ...items.map((i) => i.avgComments));
  const midX = pad + (w - pad * 2) / 2;
  const midY = pad + (h - pad * 2) / 2;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 210, display: 'block' }}>
      <rect x={pad} y={pad} width={w - pad * 2} height={h - pad * 2} fill="none" stroke="var(--line)" />
      <line x1={midX} y1={pad} x2={midX} y2={h - pad} stroke="var(--line)" strokeDasharray="3 3" />
      <line x1={pad} y1={midY} x2={w - pad} y2={midY} stroke="var(--line)" strokeDasharray="3 3" />
      {items.slice(0, 30).map((item) => {
        const x = pad + (item.postCount / maxPosts) * (w - pad * 2);
        const y = h - pad - (item.avgComments / maxAvgComments) * (h - pad * 2);
        const isSel = selected === item.subreddit;
        return (
          <g key={item.subreddit} onClick={() => onSelect(item.subreddit)} style={{ cursor: 'pointer' }}>
            <circle
              cx={x}
              cy={y}
              r={isSel ? 7 : 5}
              fill={isSel ? '#b45309' : 'var(--accent, #2563eb)'}
              opacity={isSel ? 1 : 0.78}
            >
              <title>{`r/${item.subreddit}: ${item.postCount} posts, avg ${item.avgComments} comments`}</title>
            </circle>
            <text x={x + 6} y={y + 3} fontSize="9.5" fill="var(--ink)">
              r/{item.subreddit}
            </text>
          </g>
        );
      })}
      <text x={w / 2} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
        {t('Posts count →', '发帖样本量 →')}
      </text>
      <text x={12} y={h / 2} textAnchor="middle" fontSize="10" fill="var(--muted)" transform={`rotate(-90 12 ${h / 2})`}>
        {t('Avg discussion depth →', '篇均评论深度 →')}
      </text>
    </svg>
  );
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function PostingHeatmapGrid({
  cells,
}: {
  cells: Array<{ dow: number; hour: number; count: number; avgEngagement: number }>;
}) {
  const { t } = useI18n();
  const map = new Map<string, { count: number; avgEngagement: number }>();
  let maxCount = 1;
  for (const c of cells) {
    map.set(`${c.dow}-${c.hour}`, { count: c.count, avgEngagement: c.avgEngagement });
    if (c.count > maxCount) maxCount = c.count;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
        {t('UTC 7×24 Posting Activity Heatmap', 'UTC 7×24 发帖时段热力图')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '42px repeat(24, minmax(12px, 1fr))', gap: 2, minWidth: 380 }}>
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} style={{ fontSize: 9, textAlign: 'center', color: 'var(--muted)' }} className="tabular-nums">
            {h % 4 === 0 ? h : ''}
          </div>
        ))}
        {DOW_LABELS.map((day, dow) => (
          <Fragment key={day}>
            <div style={{ fontSize: 10, color: 'var(--muted)', alignSelf: 'center' }}>{day}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const cell = map.get(`${dow}-${hour}`);
              const count = cell?.count ?? 0;
              const alpha = count === 0 ? 0.06 : 0.2 + (count / maxCount) * 0.78;
              return (
                <div
                  key={`${dow}-${hour}`}
                  title={`${day} ${String(hour).padStart(2, '0')}:00 UTC · ${count} posts`}
                  style={{
                    height: 14,
                    borderRadius: 2,
                    background: count === 0 ? 'var(--line)' : `rgba(37, 99, 235, ${alpha.toFixed(2)})`,
                  }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
