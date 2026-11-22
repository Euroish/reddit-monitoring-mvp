import { useEffect, useRef, useState, type FormEvent } from 'react';
import { providerBudgetBounds } from '../../../../packages/contracts/src/collection-budget';
import { formatApiError, useUpdateBudgetMutation } from '../api/hooks';
import type { ProviderBudget } from '../contracts/api';
import { useI18n } from '../i18n/translations';

const fields = [
  ['dailyRequests', 'daily_requests', 'Daily requests (count)', '日请求上限（次）'],
  ['monthlyRequests', 'monthly_requests', 'Monthly requests (count)', '月请求上限（次）'],
  ['dailyResources', 'daily_resources', 'Daily resources (units)', '日资源上限（单位）'],
  ['monthlyResources', 'monthly_resources', 'Monthly resources (units)', '月资源上限（单位）'],
  ['minimumIntervalMs', 'minimum_interval_ms', 'Minimum interval (ms)', '最短执行间隔（毫秒）'],
] as const;

export function ProviderBudgetEditor({ budget, onClose }: { budget: ProviderBudget; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const update = useUpdateBudgetMutation();
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: keyof typeof providerBudgetBounds) => Number(data.get(name));
    setError('');
    try {
      await update.mutateAsync({
        provider: budget.provider,
        payload: {
          enabled: data.has('enabled'),
          dailyRequests: value('dailyRequests'),
          monthlyRequests: value('monthlyRequests'),
          dailyResources: value('dailyResources'),
          monthlyResources: value('monthlyResources'),
          minimumIntervalMs: value('minimumIntervalMs'),
          revision: budget.revision,
        },
      });
      onClose();
    } catch (err) {
      setError(formatApiError(err));
    }
  }

  return (
    <dialog ref={dialog} className="sr-modal source-editor collection-dialog" aria-labelledby="provider-budget-title"
      onCancel={event => { event.preventDefault(); if (!update.isPending) onClose(); }}>
      <h2 id="provider-budget-title">{t('Edit provider budget', '调整渠道预算')} · {budget.provider}</h2>
      <p className="collection-hint">{t('Enter whole numbers. Zero in any request or resource limit prevents execution. 1,000 ms = 1 second.', '请输入整数。任一请求或资源上限为 0 会阻止执行。1,000 毫秒 = 1 秒。')}</p>
      <form onSubmit={save} className="collection-form">
        <fieldset className="source-editor-fields" disabled={update.isPending}>
          <label className="collection-checkbox"><input type="checkbox" name="enabled" defaultChecked={budget.enabled} /> {t('Enable provider budget', '启用渠道预算')}</label>
          <div className="wb-grid-2 collection-form-grid">
            {fields.map(([name, key, en, zh]) => (
              <label key={name} className="wb-field">{t(en, zh)}
                <input type="number" className="wb-input" name={name} required step={1}
                  min={providerBudgetBounds[name].minimum} max={providerBudgetBounds[name].maximum} defaultValue={budget[key]} />
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p className="wb-alert wb-alert--error" role="alert">{error}</p>}
        <footer className="collection-toolbar collection-toolbar--end">
          <button type="button" className="ds-btn ds-btn--ghost" disabled={update.isPending} onClick={onClose}>{t('Cancel', '取消')}</button>
          <button type="submit" className="ds-btn" disabled={update.isPending}>{update.isPending ? t('Saving…', '正在保存…') : t('Save budget', '更新配额')}</button>
        </footer>
      </form>
    </dialog>
  );
}
