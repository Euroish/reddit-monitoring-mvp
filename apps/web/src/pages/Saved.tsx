import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '../api/client';
import { Badge, Card } from '../components/ui';
import { buildSavedWorkbenchRoute } from '../features/workbench/model/urlState';
import { useLanguage } from '../i18n/LanguageContext';
import type { ListSavedWorkbenchViewsResponse } from '../../../../packages/contracts/src/http';

export function Saved() {
  const { language } = useLanguage();
  const copy = (en: string, zh: string) => language === 'zh-CN' ? zh : en;
  const { data, isLoading, error } = useQuery({
    queryKey: ['saved.views'],
    queryFn: () => fetchApi<ListSavedWorkbenchViewsResponse>('/v1/workbench/saved-views?limit=50'),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{copy('Saved Views', '保存视图')}</h1>
          <p className="page-subtitle">{copy('Open a saved target or comparison with its filters and series.', '恢复已保存目标或对比的过滤条件与图表系列。')}</p>
        </div>
      </div>

      {isLoading && <div style={{ color: 'var(--text-tertiary)' }}>{copy('Loading saved views...', '正在加载保存视图...')}</div>}
      {error && <div role="alert" style={{ color: '#ff4d4f' }}>{copy('Error loading saved views.', '无法加载保存视图。')} {error.message}</div>}

      {data && (
        <div className="responsive-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {data.views.map((view) => {
            const route = buildSavedWorkbenchRoute(view);
            return (
            <Card key={view.id}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '14px' }}>
                <div>
                  <h3 style={{ marginBottom: '8px' }}>{view.name}</h3>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>{view.primaryTarget}</div>
                </div>
                <Badge variant={view.viewKind === 'comparison' ? 'success' : 'neutral'}>{view.viewKind}</Badge>
              </div>

              <div className="list-stack" style={{ marginBottom: '18px' }}>
                <div className="list-row"><span>{copy('Compare targets', '对比目标')}</span><span>{view.compareTargets.length}</span></div>
                <div className="list-row"><span>{copy('Keywords', '关键词')}</span><span>{view.keywords.length}</span></div>
                <div className="list-row"><span>{copy('Series', '图表系列')}</span><span>{view.seriesIds.length}</span></div>
                <div className="list-row"><span>{copy('Updated', '更新时间')}</span><span>{new Date(view.updatedAt).toLocaleString()}</span></div>
              </div>

              {!route ? (
                <div style={{ color: 'var(--text-tertiary)', fontSize: '13px' }}>
                  {copy('This saved path cannot be opened. Save the view again from its workbench.', '该路径无法打开，请从对应工作台重新保存视图。')}
                </div>
              ) : (
                <Link to={route} style={{ color: 'var(--text-primary)', fontWeight: 560 }}>
                  {copy('Open saved view', '打开保存视图')}
                </Link>
              )}
            </Card>
          ); })}

          {data.views.length === 0 && (
            <Card>
              <div className="card-empty">{copy('No saved views yet. Save from target or compare pages.', '暂无保存视图，可以从目标或对比页面保存。')}</div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
