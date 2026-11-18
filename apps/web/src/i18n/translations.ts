import { createContext, useContext } from 'react';

export type Lang = 'en' | 'zh';

export const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (en: string, zh: string) => string;
}>({
  lang: 'zh',
  setLang: () => {},
  t: (_en, zh) => zh,
});

export function useI18n() {
  return useContext(LangContext);
}
