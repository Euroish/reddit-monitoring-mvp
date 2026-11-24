import { useState, type FormEvent } from 'react';
import { Check, Gauge } from 'lucide-react';
import {
  formatApiError,
  isMfaRequiredError,
  useGlobalBudgetQuery,
  useUpdateGlobalBudgetMutation,
} from '../api/hooks';
import { useI18n } from '../i18n/translations';
import { InlineMfaStepUp } from './InlineMfaStepUp';

export function GlobalSocialBudgetCard({ isAdmin }: { isAdmin: boolean }) {
  const { lang, t } = useI18n();
  const number = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en');
  const query = useGlobalBudgetQuery(isAdmin);
  const updateMut = useUpdateGlobalBudgetMutation();

  const [editing, setEditing] = useState(false);
  const [ceiling, setCeiling] = useState(20000);
  const [autoHydration, setAutoHydration] = useState(true);
  const [error, setError] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [notice, setNotice] = useState('');

  if (!isAdmin) return null;

  const data = query.data;

  const submitSave = async () => {
    if (!data) return;
    setError('');
    setNotice('');
    try {
      await updateMut.mutateAsync({
        dailySocialItemCeiling: ceiling,
        autoHydrationEnabled: autoHydration,
        revision: data.revision,
      });
      setNeedsMfa(false);
      setEditing(false);
      setNotice(t('Global social budget ceiling saved.', '全站社媒日采集总上限已保存。'));
    } catch (err) {
      if (isMfaRequiredError(err)) {
        setNeedsMfa(true);
      } else {
        setError(formatApiError(err));
      }
    }
  };

  return (
    <section className="ds-card collection-panel">
      <header className="ds-card-hd collection-panel-header">
        <div>
          <h3 className="ds-card-title">
            <Gauge size={15} />
            <span>{t('Global Social Collection Ceiling (Daily UTC)', '全站社媒每日总安全上限（UTC）')}</span>
          </h3>
          <p className="ds-card-sub">
            {t(
              'Cross-provider safety cap protecting total daily automated and hydration social items.',
              '跨平台兜底安全上限，用于控制全站每日自动调度与评论补充的社媒总消耗。',
            )}
          </p>
        </div>
        {data && !editing && (
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => {
              setCeiling(data.dailySocialItemCeiling);
              setAutoHydration(data.autoHydrationEnabled);
              setEditing(true);
              setError('');
              setNotice('');
            }}
          >
            {t('Configure Ceiling', '配置全局上限')}
          </button>
        )}
      </header>
      <div className="ds-card-bd">
        {query.isPending && <p className="collection-hint">{t('Loading global ceiling…', '正在加载全站预算上限…')}</p>}
        {query.isError && <p className="wb-alert wb-alert--error">{formatApiError(query.error)}</p>}
        {notice && <p className="wb-alert wb-alert--success" role="status">{notice}</p>}
        {data && (
          <dl className="collection-quota-guide">
            <div>
              <dt>{t('Daily Social Item Ceiling', '全站每日总上限')}</dt>
              <dd><strong>{number.format(data.dailySocialItemCeiling)}</strong> {t('items', '条')}</dd>
            </div>
            <div>
              <dt>{t('Reserved Today (UTC)', '今日已预留')}</dt>
              <dd><strong>{number.format(data.reservedToday)}</strong> {t('items', '条')}</dd>
            </div>
            <div>
              <dt>{t('Auto Hydration', '自动评论补充')}</dt>
              <dd><strong>{data.autoHydrationEnabled ? t('Enabled', '已开启') : t('Disabled', '已关闭')}</strong></dd>
            </div>
          </dl>
        )}
        {editing && data && (
          <form
            className="collection-editor-section"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void submitSave();
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <label className="wb-field">
                {t('Daily social item ceiling (0..5,000,000)', '每日社媒总上限（0..5,000,000）')}
                <input
                  type="number"
                  className="wb-input"
                  min={0}
                  max={5000000}
                  required
                  value={ceiling}
                  onChange={(e) => setCeiling(e.target.valueAsNumber || 0)}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingTop: 18 }}>
                <input
                  type="checkbox"
                  checked={autoHydration}
                  onChange={(e) => setAutoHydration(e.target.checked)}
                />
                <span>{t('Allow automatic community comment hydration', '允许社区热点自动补充评论')}</span>
              </label>
            </div>
            {error && <div className="wb-alert wb-alert--error" style={{ marginTop: 8 }}>{error}</div>}
            {needsMfa && <InlineMfaStepUp onVerified={submitSave} onCancel={() => setNeedsMfa(false)} />}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="submit" className="ds-btn" disabled={updateMut.isPending}>
                <Check size={12} /> {t('Save Global Ceiling', '保存全局上限')}
              </button>
              <button type="button" className="ds-btn ds-btn--ghost" onClick={() => { setEditing(false); setNeedsMfa(false); }}>
                {t('Cancel', '取消')}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
