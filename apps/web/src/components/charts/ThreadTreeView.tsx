import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { type ContentThreadResponse, formatContentAuthor } from '../../contracts/api';
import { useI18n } from '../../i18n/translations';

export function ThreadTreeView({
  thread,
  view,
  onChangeView,
  loading,
}: {
  thread: ContentThreadResponse | undefined;
  view: 'top' | 'matches' | 'op';
  onChangeView: (v: 'top' | 'matches' | 'op') => void;
  loading: boolean;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div className="seg ink">
          {(['top', 'matches', 'op'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'on' : ''}
              onClick={() => onChangeView(v)}
            >
              {v === 'top'
                ? t('Top Score', '热评排序 (top)')
                : v === 'matches'
                  ? t('Matched Only', '仅命中节点 (matches)')
                  : t('OP Replies', '楼主发言 (op)')}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {t('Read-only stored thread graph (never triggers paid crawl)', '只读已存评论树（永不触发收费外网抓取）')}
        </span>
      </div>

      {loading && (
        <div style={{ padding: 18, fontSize: 13, color: 'var(--muted)' }}>
          {t('Loading thread hierarchy...', '正在加载评论树结构...')}
        </div>
      )}

      {thread?.contextMissing && (
        <div className="wb-alert wb-alert--warn">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={15} />
            {t(
              'Root or parent chain missing (orphan comment seed or >32 hops).',
              '父链 / 根帖缺失（孤儿评论节点或父链超过 32 跳）。',
            )}
          </span>
        </div>
      )}

      {thread?.capped && (
        <div className="wb-alert wb-alert--info">
          {t('Thread output reached the 200-node cap; remaining replies are truncated.', '评论树已达 200 节点返回上限，其余回复未展开。')}
        </div>
      )}

      {!loading && thread && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Root Summary */}
          <div style={{ background: 'var(--paper)', border: '1px solid var(--wb-border)', borderRadius: 6, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>
                {t('Root Seed', '讨论根节点')} · {formatContentAuthor(thread.root.author)}
              </span>
              <span className="wb-pill wb-pill--purple">depth 0</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{thread.root.title || thread.root.text?.slice(0, 120)}</div>
          </div>

          {thread.nodes.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--muted)', border: '1px dashed var(--wb-border)', borderRadius: 6 }}>
              {t('No replies match the selected thread view.', '当前评论视图下暂无匹配回复节点。')}
            </div>
          ) : (
            thread.nodes.map((node) => {
              const isCollapsed = Boolean(collapsed[node.item.id]);
              const indentPx = Math.min(node.depth, 8) * 18;
              const extObj = (node.item.platformDetails as { extensions?: Record<string, unknown> } | undefined)?.extensions;
              const isOp =
                extObj?.isOp === true ||
                Boolean(
                  thread.root.author?.handle &&
                    node.item.author?.handle?.toLowerCase() === thread.root.author.handle.toLowerCase(),
                ) ||
                Boolean(
                  thread.root.author?.externalId &&
                    node.item.author?.externalId === thread.root.author.externalId,
                );
              const score = node.item.observations[0]?.metrics['reddit.score'];

              return (
                <div
                  key={node.item.id}
                  style={{
                    marginLeft: indentPx,
                    borderLeft: `2px solid ${node.matched ? 'var(--purple)' : 'var(--wb-border)'}`,
                    background: node.matched ? 'var(--wisteria-soft)' : 'var(--white)',
                    borderTop: '1px solid var(--wb-border-soft)',
                    borderRight: '1px solid var(--wb-border-soft)',
                    borderBottom: '1px solid var(--wb-border-soft)',
                    borderRadius: '0 6px 6px 0',
                    padding: '10px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <button
                        type="button"
                        onClick={() => toggle(node.item.id)}
                        style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', color: 'var(--muted)' }}
                        aria-label="Toggle comment node"
                      >
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <MessageSquare size={12} color="var(--muted)" />
                      <strong>{formatContentAuthor(node.item.author)}</strong>
                      {isOp && <span className="wb-pill wb-pill--teal">OP</span>}
                      {node.matched && <span className="wb-pill wb-pill--purple">{t('Matched', '命中条件')}</span>}
                      {node.contextMissing && (
                        <span className="wb-pill wb-pill--amber">{t('Parent missing', '父链缺失')}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
                      <span>depth {node.depth}</span>
                      {typeof score === 'number' && <span className="tabular-nums">score {score}</span>}
                    </div>
                  </div>
                  {!isCollapsed && (
                    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: 'var(--ink)' }}>
                      {node.item.text || <em style={{ color: 'var(--muted)' }}>[{node.item.textState}]</em>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
