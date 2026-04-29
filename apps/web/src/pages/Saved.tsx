import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Card } from '../components/ui';
import type { ListSavedWorkbenchViewsResponse } from '../../../../packages/contracts/src/http';

export function Saved() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['saved.views'],
    queryFn: () => fetchApi<ListSavedWorkbenchViewsResponse>('/v1/workbench/saved-views?limit=50'),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Saved Views</h1>
          <p className="page-subtitle">Pinned workbench entry points for target and comparison workflows.</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>Loading saved views...</div>}
      {error && <div style={{ color: '#ff4d4f' }}>Error loading saved views.</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {data.views.map((view) => (
            <Card key={view.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ marginBottom: '8px' }}>{view.name}</h3>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{view.primaryTarget}</div>
                </div>
                <Badge variant={view.viewKind === 'comparison' ? 'success' : 'neutral'}>{view.viewKind}</Badge>
              </div>

              <div className="list-stack" style={{ marginBottom: '18px' }}>
                <div className="list-row"><span>Compare targets</span><span>{view.compareTargets.length}</span></div>
                <div className="list-row"><span>Keywords</span><span>{view.keywords.length}</span></div>
                <div className="list-row"><span>Updated</span><span>{new Date(view.updatedAt).toLocaleString()}</span></div>
              </div>

              <Link to={view.routePath} style={{ color: 'var(--text-primary)', fontWeight: 560 }}>
                Open saved view
              </Link>
            </Card>
          ))}

          {data.views.length === 0 && (
            <Card>
              <div className="card-empty">No saved views yet. Save from target or compare pages.</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
