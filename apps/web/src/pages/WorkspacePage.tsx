import { Card } from '../components/ui/card';
import { useState } from 'react';
import { ArrowUpRight, Bookmark, ChevronRight, Heart, Play, Plus, Star, Trash2, Users } from 'lucide-react';
import {
  useAnnotationsListQuery,
  useDeleteSavedQueryMutation,
  useSavedQueriesQuery,
} from '../api/hooks';
import { useI18n } from '../i18n/translations';

export function WorkspacePage({
  initialQueryString = '',
  onRunSavedQuery,
  onOpenContentDetail,
  onNavigate,
}: {
  initialQueryString?: string;
  onRunSavedQuery: (qs: string) => void;
  onOpenContentDetail: (contentId: string) => void;
  onNavigate?: (path: string) => void;
}) {
  const { t } = useI18n();
  const queriesQuery = useSavedQueriesQuery(true);
  const annotationsQuery = useAnnotationsListQuery(true);
  const deleteQueryMut = useDeleteSavedQueryMutation();

  const queries = queriesQuery.data?.queries || [];
  const annotations = annotationsQuery.data?.annotations || [];

  const sp = new URLSearchParams(initialQueryString);
  const urlTab = sp.get('tab') === 'annotations' ? 'annotations' : 'queries';
  const [tabOverride, setTabOverride] = useState<{ key: string; val: 'queries' | 'annotations' } | null>(null);
  const tab = tabOverride?.key === urlTab ? tabOverride.val : urlTab;
  const setTab = (val: 'queries' | 'annotations') => setTabOverride({ key: urlTab, val });

  const runQuery = (qObj: Record<string, unknown>) => {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(qObj)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) {
        v.forEach((item) => out.append(k, String(item)));
      } else {
        out.set(k, String(v));
      }
    }
    onRunSavedQuery(out.toString());
  };

  const favoriteCount = annotations.filter((a) => a.favorite).length;
  const noteCount = annotations.filter((a) => Boolean(a.note && a.note.trim())).length;

  return (
    <div className="ds-page">
      <div className="crumb">
        <button type="button" onClick={() => onNavigate?.('/projects?view=list')}>
          {t('Research Workspace', '研究工作区')}
        </button>
        <span>/</span>
        <b>{tab === 'annotations' ? t('Annotations', '批注与收藏') : t('Saved Queries', '保存的查询')}</b>
      </div>

      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">{t('Personal Workspace', '个人工作区')}</h1>
            <span className="tag tag--lilac">/v1/workspace/*</span>
          </div>
          <p className="page-desc">
            {t(
              'Your saved queries and optimistic-lock annotations. Full read & write access applies to owner, admin, and viewer roles.',
              '仅限当前浏览器会话隔离读写你保存的查询与研究批注（含 viewer 角色在内，工作区模块完整可读写）。',
            )}
          </p>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="ds-btn"
            onClick={() => (onNavigate ? onNavigate('/content') : onRunSavedQuery(''))}
          >
            <ArrowUpRight size={13} />
            <span>{t('Go to Explorer', '去内容检索')}</span>
          </button>
        </div>
      </div>

      {/* DeepSeek 4-Cell Summary Strip */}
      <div className="ws-summary">
        <div className="ws-cell">
          <span className="wc-ico"><Bookmark size={14} /></span>
          <div>
            <b>{queries.length}</b>
            <span>{t('Saved Queries', '保存的查询')}</span>
          </div>
        </div>
        <div className="ws-cell">
          <span className="wc-ico"><Heart size={14} /></span>
          <div>
            <b>{annotations.length}</b>
            <span>{t('Notes & Favorites', '批注与收藏')}</span>
          </div>
        </div>
        <div className="ws-cell">
          <span className="wc-ico"><Play size={14} /></span>
          <div>
            <b>{queries.filter((q) => q.query.threadAware !== false).length}</b>
            <span>{t('Thread-Aware Queries', '树感知查询数')}</span>
          </div>
        </div>
        <div className="ws-cell">
          <span className="wc-ico"><Users size={14} /></span>
          <div>
            <b>{annotations.filter((a) => a.favorite).length}</b>
            <span>{t('Starred Evidence', '标星关键证据')}</span>
          </div>
        </div>
      </div>

      <div style={{ borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <div className="tabs">
          <button type="button" aria-selected={tab === 'queries'} onClick={() => setTab('queries')}>
            {t('Saved Queries', '保存的查询')} <span className="tag" style={{ height: 17, fontSize: 9, marginLeft: 4 }}>{queries.length}</span>
          </button>
          <button type="button" aria-selected={tab === 'annotations'} onClick={() => setTab('annotations')}>
            {t('Annotations & Starred', '批注与收藏')} <span className="tag" style={{ height: 17, fontSize: 9, marginLeft: 4 }}>{annotations.length}</span>
          </button>
        </div>
      </div>

      {tab === 'queries' ? (
        <div className="query-grid">
          {queries.map((sq) => (
            <div key={sq.id} className="query-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <h4 style={{ fontSize: 13, fontWeight: 620, margin: 0 }}>{sq.name}</h4>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#9aa294' }}>rev {sq.revision}</span>
              </div>

              <div className="qc-chips">
                {sq.query.query && <span className="t">q: {sq.query.query}</span>}
                {sq.query.anyTerms?.map((term) => (
                  <span key={term} className="t">OR: {term}</span>
                ))}
                {sq.query.allTerms?.map((term) => (
                  <span key={term}>AND: {term}</span>
                ))}
                {sq.query.signal && <span>signal: {sq.query.signal}</span>}
                {sq.query.platform && <span>{sq.query.platform}</span>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f3f5ee', paddingTop: 9, fontSize: 10, color: 'var(--faint)' }}>
                <span>{sq.updated_at.slice(0, 10)}</span>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    style={{ border: 0, background: 'none', fontWeight: 650, color: 'var(--ink-3)', cursor: 'pointer', fontSize: 11 }}
                    onClick={() => runQuery(sq.query as Record<string, unknown>)}
                  >
                    {t('Run', '运行')}
                  </button>
                  <button
                    type="button"
                    style={{ border: 0, background: 'none', fontWeight: 600, color: '#a8462f', cursor: 'pointer', fontSize: 11 }}
                    onClick={() => deleteQueryMut.mutate(sq.id)}
                  >
                    <Trash2 size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                    {t('Delete', '删除')}
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="query-card"
            onClick={() => (onNavigate ? onNavigate('/content') : onRunSavedQuery(''))}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              minHeight: 148,
              borderStyle: 'dashed',
              color: 'var(--faint)',
              cursor: 'pointer',
            }}
          >
            <Plus size={20} />
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('Save New Query in Explorer', '前往检索页保存新查询')}</span>
            <span style={{ fontSize: 10 }}>{t('Preserves filter fingerprint cleanly', '保存后将直接关联在此展示')}</span>
          </button>
        </div>
      ) : (
        <div className="ds-grid">
          <div className="c8">
            <div className="ds-card">
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title">
                    <Heart size={14} color="var(--wb-purple)" />
                    <span>{t('Annotations & Starred Evidence', '批注与收藏列表')}</span>
                  </div>
                  <div className="ds-card-sub">{t('Optimistic lock protected up to 2,000 chars', '批注上限 2,000 字符 · 乐观锁并发校验')}</div>
                </div>
                <span className="tag tag--line">{annotations.length} {t('items', '条')}</span>
              </div>

              <div className="ds-card-bd" style={{ paddingTop: 4 }}>
                {annotations.length === 0 ? (
                  <div style={{ padding: 28, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>
                    {t('No annotations yet. Open any content item to star or write research notes.', '暂无批注记录，可在内容详情抽屉中标星收藏或编写研判笔记。')}
                  </div>
                ) : (
                  annotations.map((ann) => (
                    <div key={ann.content_id} className="note-row">
                      <Star
                        size={15}
                        fill={ann.favorite ? '#eab308' : 'none'}
                        color={ann.favorite ? '#c99b1d' : '#c9d0c4'}
                        style={{ flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h4 style={{ fontSize: 12.5, fontWeight: 600, margin: 0, color: 'var(--ink)' }}>
                          {ann.title || ann.body_text?.slice(0, 70) || ann.external_id}
                        </h4>
                        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, marginTop: 3 }}>
                          {ann.note || <em>{t('Starred without written note.', '仅标星收藏，无文字批注。')}</em>}
                        </p>
                        <div style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 4, display: 'flex', gap: 8 }}>
                          <span>{ann.external_id}</span>
                          <span>·</span>
                          <span>revision {ann.revision}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-square"
                        style={{ width: 28, height: 28 }}
                        onClick={() => onOpenContentDetail(ann.content_id)}
                        title={t('Open content drawer', '查看原帖抽屉')}
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="c4">
            <Card className="ds-card" style={{ height: '100%' }}>
              <div className="ds-card-hd">
                <div>
                  <div className="ds-card-title">{t('Research Summary', '研究记录概览')}</div>
                  <div className="ds-card-sub">{t('Direct counts from your workspace', '当前工作区真实统计口径')}</div>
                </div>
              </div>
              <div className="ds-card-bd">
                <div style={{ display: 'grid', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2, #f7f9f4)', borderRadius: 6 }}>
                    <span>{t('Total annotated items', '已保存批注条目')}</span>
                    <b className="tabular-nums" style={{ color: 'var(--ink)' }}>{annotations.length}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2, #f7f9f4)', borderRadius: 6 }}>
                    <span>{t('Bookmarked evidence', '标星收藏证据')}</span>
                    <b className="tabular-nums" style={{ color: 'var(--ink)' }}>{favoriteCount}</b>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-2, #f7f9f4)', borderRadius: 6 }}>
                    <span>{t('Items with written notes', '含文字笔记条目')}</span>
                    <b className="tabular-nums" style={{ color: 'var(--ink)' }}>{noteCount}</b>
                  </div>
                </div>
              </div>
              <div className="ds-card-ft">
                <span>{t('No estimated completion ratio', '仅展示真实记录条数')}</span>
                <button type="button" onClick={() => (onNavigate ? onNavigate('/content') : onRunSavedQuery(''))}>
                  {t('Continue →', '继续研判 →')}
                </button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
