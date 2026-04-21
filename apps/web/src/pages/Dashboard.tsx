import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Card, Badge } from '../components/ui';
import type { MarketTrendResponse } from '../../../../packages/contracts/src/http';

export function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-trend'],
    queryFn: () => fetchApi<MarketTrendResponse>('/v1/trends/market'),
  });

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">Market overview and hot targets</p>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading market trends...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading data</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <Card>
            <h3 style={{ marginBottom: '16px' }}>Top by Heat</h3>
            <div className="list-stack" style={{ gap: '12px' }}>
              {data.rankings.byHeat.slice(0, 5).map((item, idx) => (
                <div key={item.targetId} className="list-row">
                  <div className="list-row-start">
                    <span style={{ color: 'var(--text-quaternary)', width: '20px' }}>{idx + 1}.</span>
                    <Link
                      to={`/target/${item.canonicalName.replace('r/', '')}`}
                      style={{ fontWeight: 510, color: 'var(--text-primary)', textDecoration: 'none' }}
                      className="break-text"
                    >
                      {item.canonicalName}
                    </Link>
                  </div>
                  <div className="list-row-end">
                    <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{Math.round(item.heatIndex)} heat</span>
                    {item.heatChangePct > 0 && <Badge variant="success">+{item.heatChangePct.toFixed(1)}%</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 style={{ marginBottom: '16px' }}>Top by Surge</h3>
            <div className="list-stack" style={{ gap: '12px' }}>
              {data.rankings.bySurge.slice(0, 5).map((item, idx) => (
                <div key={item.targetId} className="list-row">
                  <div className="list-row-start">
                    <span style={{ color: 'var(--text-quaternary)', width: '20px' }}>{idx + 1}.</span>
                    <Link
                      to={`/target/${item.canonicalName.replace('r/', '')}`}
                      style={{ fontWeight: 510, color: 'var(--text-primary)', textDecoration: 'none' }}
                      className="break-text"
                    >
                      {item.canonicalName}
                    </Link>
                  </div>
                  <span style={{ fontSize: '13px', color: 'var(--text-tertiary)' }}>{item.surgeScore.toFixed(2)} score</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
