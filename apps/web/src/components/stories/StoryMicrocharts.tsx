import type { StoryItem } from '../../contracts/api';

export function StoryMicrocharts({ story }: { story: StoryItem }) {
  const { tierBreakdown, sparkline48h } = story;
  if (!tierBreakdown || sparkline48h?.length !== 8) return null;
  const tiers = ['T1', 'T1_5', 'T2'] as const;
  const total = tiers.reduce((sum, tier) => sum + tierBreakdown[tier], 0);
  const peak = Math.max(...sparkline48h, 0.01);
  const points = sparkline48h
    .map((value, index) => `${2 + index * 11},${13 - (11 * value) / peak}`)
    .join(' ');

  return (
    <div className="story-microcharts">
      {total > 0 && (
        <span className="story-mc-group">
          <span className="story-mc-label" aria-hidden="true">来源分布</span>
          <svg
            width="64"
            height="14"
            viewBox="0 0 64 14"
            role="img"
            aria-label={`来源分布：${tiers.map((tier) => `${tier} ${tierBreakdown[tier]}`).join('，')}`}
          >
            <title>{tiers.map((tier) => `${tier}：${tierBreakdown[tier]}`).join('，')}</title>
            {tiers.map((tier, index) => (
              <rect
                key={tier}
                className={`story-tier-bar-${tier.toLowerCase()}`}
                x={(64 * tiers.slice(0, index).reduce((sum, earlier) => sum + tierBreakdown[earlier], 0)) / total}
                y="4"
                width={(64 * tierBreakdown[tier]) / total}
                height="6"
                rx="1"
              />
            ))}
          </svg>
        </span>
      )}
      <span className="story-mc-group">
        <span className="story-mc-label" aria-hidden="true">48h 走势</span>
        <svg
          width="80"
          height="14"
          viewBox="0 0 80 14"
          role="img"
          aria-label={`已采样热度，从早到晚每 6 小时：${sparkline48h.map((value) => value.toFixed(2)).join('，')}`}
        >
          <title>已采样热度 · 每 6 小时</title>
          <path d="M2 13H78" stroke="#dce0d5" strokeWidth="1" />
          <polyline
            points={points}
            fill="none"
            stroke="var(--wb-purple)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
