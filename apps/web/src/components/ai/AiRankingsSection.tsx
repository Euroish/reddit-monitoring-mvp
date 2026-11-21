import { useState } from 'react';
import { BarChart3, ExternalLink, Info } from 'lucide-react';
import { useAiRankingsQuery } from '../../api/ai-client';
import { useI18n } from '../../i18n/translations';
import { safeHttpUrl } from '../../lib/sourceLabels';

type RankCategory = 'general' | 'coding' | 'reasoning' | 'speed_price';

const CATEGORIES: Array<{ id: RankCategory; en: string; zh: string }> = [
  { id: 'general', en: 'General Intelligence', zh: '综合能力' },
  { id: 'coding', en: 'Coding', zh: '代码能力' },
  { id: 'reasoning', en: 'Reasoning / Math', zh: '推理与数学' },
  { id: 'speed_price', en: 'Throughput & Pricing', zh: '速度与吞吐' },
];

export function AiRankingsSection() {
  const { t } = useI18n();
  const [category, setCategory] = useState<RankCategory>('general');
  const rankingsQ = useAiRankingsQuery(category);

  const snapshots = rankingsQ.data?.items ?? [];
  const configured = rankingsQ.data?.configured ?? false;
  const publicAllowed = rankingsQ.data?.publicRedistributionAllowed ?? false;
  const internalCount = rankingsQ.data?.internalSnapshotCount ?? 0;

  return (
    <section className="ai-section" id="rankings" aria-label={t('AI Model Rankings', '模型能力榜单')}>
      <div className="ai-section__head">
        <div>
          <h2 className="ai-section__title">{t('Licensed Model Benchmarks', '第三方评测榜单（分指标独立展示）')}</h2>
          <p className="ai-section__sub">
            {t(
              'Each benchmark metric is displayed in its own original scale with attribution and snapshot date. Never mixed into fabricated composite scores.',
              '每个榜单严格按单一原始指标、版本、评测日期与授权署名展示，不拼接伪造“SIFTLINE 综合分”。',
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="tablist" aria-label={t('Benchmark categories', '榜单分类')}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              className={`ai-pill-btn ${category === c.id ? 'is-active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {t(c.en, c.zh)}
            </button>
          ))}
        </div>
      </div>

      <div className="ai-card-surface">
        {rankingsQ.isLoading ? (
          <p style={{ color: 'var(--muted)', fontSize: 13.5, margin: 0 }}>{t('Loading benchmark snapshots...', '正在加载评测快照...')}</p>
        ) : snapshots.length === 0 ? (
          <div className="ai-empty-box">
            <BarChart3 size={24} style={{ marginBottom: 8, color: 'var(--teal)' }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>
              {internalCount > 0 && !publicAllowed
                ? t('Benchmark snapshots synced for internal use only', '外部评测快照已内部同步（暂未开启公开再分发授权）')
                : configured
                  ? t('No benchmark snapshot in this category yet', '当前分类暂无已同步评测快照')
                  : t('External benchmark feed not configured', '外部授权评测数据源尚未配置')}
            </div>
            <p style={{ margin: '0 auto', maxWidth: 560, lineHeight: 1.6 }}>
              {internalCount > 0 && !publicAllowed
                ? t(
                    'Current Artificial Analysis snapshots were synced under the free/internal-use API tier. Public display is intentionally gated until commercial redistribution licensing (ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION=true) is enabled. Administrators can inspect internal snapshots in /admin/queue.',
                    '当前 Artificial Analysis 快照通过免费内部使用端点同步。为严格遵守第三方数据再分发许可，在未获得商业公开授权（ARTIFICIAL_ANALYSIS_PUBLIC_REDISTRIBUTION=true）前不在公开页展示；管理员可在 /admin/queue 内部查看已同步数据。',
                  )
                : configured
                  ? t(
                      'Trigger a sync from the AI Review Queue to capture the latest licensed snapshot.',
                      '请在管理后台 AI 审核队列中手动触发一次同步，以拉取最新授权快照。',
                    )
                  : t(
                      'SIFTLINE does not fabricate benchmark scores or scrape unlicensed leaderboards. Configure ARTIFICIAL_ANALYSIS_API_KEY (or import a licensed snapshot) to display live rankings with full attribution.',
                      'SIFTLINE 不虚构评测分数，也不抓取未授权榜单。配置 ARTIFICIAL_ANALYSIS_API_KEY（或导入已授权快照）后，此处将自动展示带完整署名的真实榜单。',
                    )}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {snapshots.map((snap) => (
              <div key={snap.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: '0 0 2px', fontSize: 16, fontWeight: 700 }}>
                      {snap.metricName}{' '}
                      {snap.metricVersion && (
                        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>({snap.metricVersion})</span>
                      )}
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Info size={12} />
                      <span>{snap.attributionText}</span>
                      <span>· {t('Captured', '快照日期')}: {snap.capturedAt.slice(0, 10)}</span>
                      {snap.attributionUrl && safeHttpUrl(snap.attributionUrl) && (
                        <a
                          href={safeHttpUrl(snap.attributionUrl)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--teal)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        >
                          {t('Methodology', '评测说明')} <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="ai-table-wrap">
                  <table className="ai-rank-table">
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}>#</th>
                        <th>{t('Model', '模型')}</th>
                        <th>{t('Vendor', '厂商')}</th>
                        <th style={{ textAlign: 'right' }}>
                          {snap.unit ? `${t('Score', '指标值')} (${snap.unit})` : t('Score', '指标值')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.entries.slice(0, 15).map((e) => (
                        <tr key={e.id}>
                          <td style={{ fontWeight: 700, color: 'var(--muted)' }}>{String(e.rank).padStart(2, '0')}</td>
                          <td style={{ fontWeight: 600 }}>{e.modelName}</td>
                          <td style={{ color: 'var(--muted)' }}>{e.vendorName || '—'}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            {e.score.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
