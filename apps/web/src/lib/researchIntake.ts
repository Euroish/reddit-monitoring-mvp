import { ApiError } from '../contracts/api';
import { useI18n } from '../i18n/translations';
export { getRangeLimits, parseManualTargets, type ManualTarget } from './collectionLimits';

export function useIntakeError() {
  const { t } = useI18n();
  return (error: unknown, submitting = false) => {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 401) return t('Sign in again to continue.', '请重新登录后继续。');
    if (status === 403) return error instanceof ApiError ? error.message : t('Your permission or quota has changed.', '权限或可用额度已变化。');
    if (status === 404) return t('The source, data or project is no longer available.', '这个来源、数据记录或项目已不可用。');
    if (status === 409 || status === 422) {
      const base = t('Collection settings or the service budget may have changed. Check the estimate before starting again.', '采集配置或服务预算可能已变化，请核对预计消耗后再开始。');
      return error instanceof ApiError && error.message ? `${base} (${error.message})` : base;
    }
    if (status === 429) return t('The service is busy. Wait a moment and try again.', '当前请求较多，请稍后重试。');
    return submitting
      ? t('The submission result could not be confirmed. Retry this same request to avoid starting it twice.', '暂时无法确认提交结果。请重试本次请求，避免重复开始采集。')
      : t('Could not check availability. Please try again.', '暂时无法检查可用性，请重试。');
  };
}
