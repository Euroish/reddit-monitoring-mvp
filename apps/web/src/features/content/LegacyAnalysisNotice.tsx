import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';

export function LegacyAnalysisNotice() {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return <p role="note" style={{ margin: '0 0 20px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
    {zh ? '此页使用旧 Reddit 分析读模型，尚未纳入来源采集的 Arctic Shift / X 观测；这些数值不代表新来源总量或全平台热度。'
      : 'This page uses the older Reddit analysis read model. Collected Arctic Shift / X observations are not included; these values are not new-source totals or platform-wide heat.'}
    {' '}<Link to="/content">{zh ? '查询来源内容与已存统计' : 'Open collected content and stored counts'}</Link>
  </p>;
}

export function SourceEmptyLink() {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  return <p style={{ margin: '16px 0', color: 'var(--text-secondary)', lineHeight: 1.65 }}>
    {zh ? '若要查看新来源内容，' : 'For newer source content, '}{' '}
    <Link to="/content">{zh ? '添加或管理来源，查询已采集内容' : 'Add or manage sources to query collected content'}</Link>
  </p>;
}
