import type { CollectionSource } from '../contracts/api';
import { useI18n } from '../i18n/translations';

export function useSourceStatus() {
  const { t, lang } = useI18n();
  const timestamp = (date: string) => new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(date));
  const status = (source: CollectionSource) => {
    if (source.state === 'archived') return t('Archived', '已归档');
    if (source.state === 'paused') return t('Paused', '已暂停');
    if (source.automaticCollectionBlocked) return t('Charge needs review', '计费待核实');
    if (source.health.lastStatus === 'failed') return t('Needs attention', '需处理');
    if (source.deliveryMode === 'push') return t('External delivery', '外部推送');
    if (source.health.lastNotModified) return t('Unchanged', '来源未变化');
    if (source.health.lastStatus === 'succeeded' && source.health.lastFetchedCount === 0) return t('No new content', '暂无新内容');
    if (source.health.lastStatus === 'succeeded') return t('Last run succeeded', '最近运行成功');
    return t('Not run yet', '尚未运行');
  };
  return { timestamp, status };
}
