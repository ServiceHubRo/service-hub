import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nContext, type I18nValue } from './context';
import { formatDate, formatKm, formatMoney, formatRelativeDays, formatTime } from './format';
import { detectLang, LANG_STORAGE_KEY, plural, translate, type Lang } from './translate';
import { storage } from '../lib/storage';

function initialLang(): Lang {
  return detectLang(storage.get(LANG_STORAGE_KEY), typeof navigator === 'undefined' ? undefined : navigator.language);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // After login (T04) the profile language also gets updated here.
  const setLang = useCallback((next: Lang) => {
    storage.set(LANG_STORAGE_KEY, next);
    setLangState(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => translate(lang, key, params),
      plural: (base, n) => plural(lang, base, n),
      money: (amount) => formatMoney(lang, amount),
      km: (n) => formatKm(lang, n),
      date: (d) => formatDate(lang, d),
      time: (d) => formatTime(lang, d),
      relDays: (d, now) => formatRelativeDays(lang, d, now),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
