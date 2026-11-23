import { ApiError, type ResearchPlanPreviewResponse } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function getRangeLimits(result: ResearchPlanPreviewResponse, fallbackProvider?: string) {
  const target = result.matchedSource?.target.type;
  const provider = fallbackProvider ?? result.matchedSource?.provider;
  return {
    maxDays: result.fieldPolicy.maxLookbackDays,
    maxItems: Math.min(result.fieldPolicy.maxBatchLimit, provider === 'twitterapis' ? 20 : provider === 'kaix' ? 300 : provider === 'red_crawler' && target === 'post' ? 50 : 100),
    maxComments: provider === 'kaix' && target !== 'post' ? result.fieldPolicy.maxCommentsPerPost : 0,
  };
}

export function useIntakeError() {
  const { t } = useI18n();
  return (error: unknown, submitting = false) => {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 401) return t('Sign in again to continue.', '请重新登录后继续。');
    if (status === 403) return t('Your permission or quota has changed. Check what is available and try again.', '权限或可用额度已变化。请核对额度与采集权限后重试。');
    if (status === 404) return t('The source, data or project is no longer available.', '这个来源、数据记录或项目已不可用。');
    if (status === 409 || status === 422) return t('Collection settings or the service budget may have changed. Check the estimate before starting again.', '采集配置或服务预算可能已变化，请核对预计消耗后再开始。');
    if (status === 429) return t('The service is busy. Wait a moment and try again.', '当前请求较多，请稍后重试。');
    return submitting
      ? t('The submission result could not be confirmed. Retry this same request to avoid starting it twice.', '暂时无法确认提交结果。请重试本次请求，避免重复开始采集。')
      : t('Could not check availability. Please try again.', '暂时无法检查可用性，请重试。');
  };
}
