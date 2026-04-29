import { Languages } from 'lucide-react';
import { useLanguage } from './LanguageContext';

export function LanguageToggle({ className }: { className?: string }) {
  const { language, toggleLanguage, t } = useLanguage();
  const nextLabel = language === 'en' ? '简体中文' : 'English';

  return (
    <button
      type="button"
      className={className ?? 'language-toggle'}
      onClick={toggleLanguage}
      aria-label={t('Language')}
      title={nextLabel}
    >
      <Languages size={15} strokeWidth={1.8} />
      <span>{language === 'en' ? '中文' : 'EN'}</span>
    </button>
  );
}
