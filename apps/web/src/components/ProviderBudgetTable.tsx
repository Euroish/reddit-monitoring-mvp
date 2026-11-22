import { Sliders } from 'lucide-react';
import type { ProviderBudget, SourceCapability } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function ProviderBudgetTable({ budgets, providers, pending, onEdit }: {
  budgets: ProviderBudget[];
  providers: SourceCapability[];
  pending: boolean;
  onEdit: (budget: ProviderBudget) => void;
}) {
  const { lang, t } = useI18n();
  const number = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en');
  return (
    <section className="ds-card collection-panel" aria-labelledby="provider-budgets-title">
      <header className="ds-card-hd collection-panel-header">
        <div>
          <h2 className="ds-card-title" id="provider-budgets-title"><Sliders size={16} />{t('System provider budgets', '系统渠道预算')}</h2>
          <p className="ds-card-sub">{t('Daily windows reset at 00:00 UTC. Monthly windows reset on the first day of each month at 00:00 UTC.', '日额度按 UTC 零点重置，月额度按 UTC 每月 1 日零点重置。')}</p>
        </div>
      </header>
      <dl className="collection-quota-guide">
        <div><dt>{t('Requests (count)', '请求（次）')}</dt><dd>{t('One count when the worker starts a metered provider execution. Each execution can make several upstream calls.', 'Worker 每开始一次计额执行记 1 次。一次执行可能包含多次上游调用。')}</dd></div>
        <div><dt>{t('Resources (units)', '资源（单位）')}</dt><dd>{t('The worker reserves units before execution using the provider and batch size. For X collection it reserves the provider page allowance (TwitterAPIs 20, ScrapeBadger 100). Billing and stored items are separate.', 'Worker 按渠道和批次在执行前预留。X 拉取按渠道页上限预留（TwitterAPIs 20，ScrapeBadger 100）。第三方账单和实际入库条数单独计算。')}</dd></div>
        <div><dt>{t('Minimum interval (ms)', '最短间隔（毫秒）')}</dt><dd>{t('Time between metered executions for the same provider. A cap of zero blocks execution. Exhausted windows can defer queued jobs.', '同一渠道的两次计额执行之间至少等待该时长。任一上限为 0 会阻止执行，窗口额度耗尽时任务可排队等待。')}</dd></div>
      </dl>
      {budgets.length > 0 ? (
        <div className="collection-table-scroll" role="region" aria-label={t('Provider budgets table', '渠道预算表')} tabIndex={0}>
          <table className="collection-table collection-budgets-table">
            <thead><tr>
              <th scope="col">{t('Provider', '渠道')}</th>
              <th scope="col">{t('Budget / readiness', '预算与就绪状态')}</th>
              <th scope="col">{t('Requests today', '日请求（次）')}</th>
              <th scope="col">{t('Requests this month', '月请求（次）')}</th>
              <th scope="col">{t('Resources today', '日资源（单位）')}</th>
              <th scope="col">{t('Resources this month', '月资源（单位）')}</th>
              <th scope="col">{t('Interval (ms)', '间隔（毫秒）')}</th>
              <th scope="col">{t('Action', '操作')}</th>
            </tr></thead>
            <tbody>{budgets.map(budget => {
              const capability = providers.find(provider => provider.provider === budget.provider);
              const canRun = budget.enabled && Math.min(budget.daily_requests, budget.monthly_requests, budget.daily_resources, budget.monthly_resources) > 0;
              const meters = [
                [budget.requests_today, budget.daily_requests], [budget.requests_month, budget.monthly_requests],
                [budget.resources_today, budget.daily_resources], [budget.resources_month, budget.monthly_resources],
              ];
              return (
                <tr key={budget.provider}>
                  <th scope="row">{budget.provider}</th>
                  <td>
                    <span className={'collection-status ' + (canRun ? 'collection-status--ok' : '')}>
                      {!budget.enabled ? t('Budget off', '预算停用') : canRun ? t('Budget on', '预算启用') : t('Zero cap', '存在零上限')}
                    </span>
                    <small>{!capability ? t('Readiness unknown', '就绪未知') : capability.enabled ? t('Provider ready', '渠道就绪') : t('Provider unavailable', '渠道未就绪')}</small>
                  </td>
                  {meters.map(([used, cap], index) => (
                    <td className="collection-quantity" key={index}>
                      <div><strong>{used === undefined ? '—' : number.format(used)}</strong> / {number.format(cap ?? 0)}</div>
                      {cap !== undefined && cap > 0 && used !== undefined && (
                        <meter min={0} max={cap} value={Math.min(cap, used)} aria-label={t('Used or reserved out of limit', '用量或预留占上限')} />
                      )}
                    </td>
                  ))}
                  <td className="collection-quantity">{number.format(budget.minimum_interval_ms)}</td>
                  <td><button type="button" className="ds-btn ds-btn--ghost" onClick={() => onEdit(budget)}>{t('Edit budget', '调整配额')}</button></td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="collection-panel-note">{t('Figures show used requests or reserved resources / configured limit.', '数字显示已计请求或已预留资源 / 配置上限。')}</p>
        </div>
      ) : <p className="collection-empty" role="status">{pending ? t('Loading budgets…', '正在加载渠道预算…') : t('No provider budgets were returned.', '服务端未返回渠道预算。')}</p>}
    </section>
  );
}
