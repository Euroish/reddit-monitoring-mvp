import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card, Badge } from '../components/ui';
import type { MarketTrendResponse } from '../../../../packages/contracts/src/http';

function formatSignedPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function targetPath(canonicalName: string): string {
  return `/target/${canonicalName.replace('r/', '')}`;
}

function RankingSection({
  title,
  subtitle,
  items,
  accent,
  metricLabel,
  metricValue,
}: {
  title: string;
  subtitle: string;
  items: MarketTrendResponse['rankings']['byHeat'];
  accent: string;
  metricLabel: string;
  metricValue: (item: MarketTrendResponse['rankings']['byHeat'][number]) => string;
}) {
  const visibleItems = items.slice(0, 8);

  return (
    <Card style={{ padding: '0', overflow: 'hidden' }}>
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border-standard)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
          <h3 style={{ fontSize: '18px' }}>{title}</h3>
          <Badge style={{ borderColor: accent, color: accent }}>{visibleItems.length} tracked</Badge>
        </div>
        <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{subtitle}</div>
      </div>

      <div>
        {visibleItems.map((item, idx) => (
          <div
            key={`${title}-${item.targetId}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px minmax(0, 1.4fr) minmax(92px, 0.8fr) minmax(92px, 0.8fr)',
              gap: '12px',
              alignItems: 'center',
              padding: '14px 20px',
              borderBottom: idx === visibleItems.length - 1 ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ color: 'var(--text-quaternary)', fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {String(idx + 1).padStart(2, '0')}
            </div>
            <div style={{ minWidth: 0 }}>
              <Link
                to={targetPath(item.canonicalName)}
                style={{ color: 'var(--text-primary)', fontWeight: 560, display: 'inline-block', marginBottom: '4px' }}
                className="break-text"
              >
                {item.canonicalName}
              </Link>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>
                {item.sampledPostCount} sampled posts in window
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--text-quaternary)', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {metricLabel}
              </div>
              <div style={{ fontWeight: 560 }}>{metricValue(item)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--text-quaternary)', fontSize: '11px', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Window posts
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>{item.newPosts}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-trend'],
    queryFn: () => fetchApi<MarketTrendResponse>('/v1/trends/market'),
  });

  const hottest = data?.rankings.byHeat[0];
  const strongestSurge = data?.rankings.bySurge[0];
  const widestDispersion = data?.rankings.byDispersion[0];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Markets</h1>
          <p className="page-subtitle">Monitored Reddit market board with TradingView-like sectioned discovery</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading market trends...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading data</div>}

      {data && (
        <div className="markets-shell">
          <Card
            style={{
              background:
                'radial-gradient(circle at top left, rgba(94,106,210,0.26), rgba(113,112,255,0.04) 40%, rgba(255,255,255,0.02) 100%)',
              overflow: 'hidden',
            }}
          >
            <div className="markets-hero">
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    borderRadius: '999px',
                    border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    marginBottom: '16px',
                  }}
                >
                  {data.coverage.label}
                </div>
                <h2 style={{ fontSize: '36px', lineHeight: 1.05, letterSpacing: '-0.04em', marginBottom: '12px' }}>
                  Markets, everywhere. Monitored truth only.
                </h2>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '720px', marginBottom: '20px' }}>
                  Inspired by TradingView markets structure, but scoped honestly to monitored subreddits with trend points in range.
                </p>
                <div className="markets-link-row">
                  {hottest && (
                    <Link to={targetPath(hottest.canonicalName)} className="markets-primary-link">
                      Open hottest target
                    </Link>
                  )}
                  <Link to="/queries" className="markets-secondary-link">
                    Run keyword query
                  </Link>
                </div>
              </div>

              <div className="markets-summary-grid">
                <div className="markets-summary-card">
                  <div className="markets-summary-label">Monitored targets</div>
                  <div className="markets-summary-value">{data.coverage.monitoredTargetCount}</div>
                  <div className="markets-summary-note">With trend coverage inside the selected range</div>
                </div>
                <div className="markets-summary-card">
                  <div className="markets-summary-label">Hottest board leader</div>
                  <div className="markets-summary-value" style={{ fontSize: '24px' }}>{hottest?.canonicalName ?? 'n/a'}</div>
                  <div className="markets-summary-note">
                    {hottest ? `${Math.round(hottest.heatIndex)} heat · ${formatSignedPct(hottest.heatChangePct)}` : 'No ranked target yet'}
                  </div>
                </div>
                <div className="markets-summary-card">
                  <div className="markets-summary-label">Strongest surge</div>
                  <div className="markets-summary-value">{strongestSurge ? strongestSurge.surgeScore.toFixed(2) : 'n/a'}</div>
                  <div className="markets-summary-note">{strongestSurge?.canonicalName ?? 'No ranked target yet'}</div>
                </div>
                <div className="markets-summary-card">
                  <div className="markets-summary-label">Widest dispersion</div>
                  <div className="markets-summary-value">{widestDispersion ? widestDispersion.dispersionScore.toFixed(2) : 'n/a'}</div>
                  <div className="markets-summary-note">{widestDispersion?.canonicalName ?? 'No ranked target yet'}</div>
                </div>
              </div>
            </div>
          </Card>

          <div className="markets-stats-grid">
            <Card>
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ marginBottom: '6px' }}>Market Snapshot</h3>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{data.coverage.description}</div>
              </div>
              <div className="metric-grid">
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Generated</div>
                  <div style={{ fontWeight: 560 }}>{new Date(data.generatedAtIso).toLocaleString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>From</div>
                  <div style={{ fontWeight: 560 }}>{new Date(data.fromIso).toLocaleDateString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>To</div>
                  <div style={{ fontWeight: 560 }}>{new Date(data.toIso).toLocaleDateString()}</div>
                </div>
                <div>
                  <div style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Ranked targets</div>
                  <div className="kpi-value">{data.targetCount}</div>
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ marginBottom: '14px' }}>
                <h3 style={{ marginBottom: '6px' }}>Heat Strip</h3>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                  Quick scan of the current leaders in the monitored board.
                </div>
              </div>
              <div className="markets-strip-grid">
                {data.rankings.byHeat.slice(0, 8).map((item) => (
                  <Link key={item.targetId} to={targetPath(item.canonicalName)} className="markets-strip-tile">
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Heat leader</div>
                    <div style={{ fontWeight: 560, color: 'var(--text-primary)', marginBottom: '8px' }}>{item.canonicalName}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '22px', fontWeight: 600, color: 'var(--text-primary)' }}>{Math.round(item.heatIndex)}</span>
                      <Badge variant={item.heatChangePct > 0 ? 'success' : 'neutral'}>
                        {formatSignedPct(item.heatChangePct)}
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          <div className="markets-board-grid">
            <RankingSection
              title="Top Heat"
              subtitle="Closest analogue to a monitored market leaders board."
              items={data.rankings.byHeat}
              accent="var(--status-emerald)"
              metricLabel="Heat"
              metricValue={(item) => `${Math.round(item.heatIndex)}`}
            />
            <RankingSection
              title="Top Surge"
              subtitle="Fast-moving monitored targets ranked by surge score."
              items={data.rankings.bySurge}
              accent="var(--accent-violet)"
              metricLabel="Surge"
              metricValue={(item) => item.surgeScore.toFixed(2)}
            />
            <RankingSection
              title="Top Dispersion"
              subtitle="Targets with the widest spread of attention across observed posts."
              items={data.rankings.byDispersion}
              accent="var(--security-lavender)"
              metricLabel="Dispersion"
              metricValue={(item) => item.dispersionScore.toFixed(2)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
