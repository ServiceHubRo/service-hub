import { createContext, useContext } from 'react';
import type { MessageKey } from './ro';
import type { Lang, Params, plural } from './translate';

export interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, params?: Params) => string;
  plural: (base: Parameters<typeof plural>[1], n: number) => string;
  money: (amount: number) => string;
  km: (n: number) => string;
  date: (d: Date | string) => string;
  time: (d: Date) => string;
  relDays: (d: Date | string, now?: Date) => string;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
