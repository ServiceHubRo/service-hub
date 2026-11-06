import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { useI18n } from '../i18n/context';
import { useTouchSelect } from '../lib/touchSelect';
import { useSession } from './sessionContext';
import type { Lang } from '../i18n/translate';
import styles from './LangSwitch.module.css';

const LANGS: Lang[] = ['ro', 'en'];

/**
 * The language: a compact dropdown „RO ▾” (Eduard, 6 Nov 2026: no segmented buttons), the same native
 * select (the system's own list), drawn quiet: a hairline box with the code and a small chevron.
 */
export function LangSwitch() {
  const { lang, t } = useI18n();
  // Also saved on the profile when signed in (ARCHITECTURE §15).
  const { setLanguage } = useSession();
  const id = useId();
  const touch = useTouchSelect((e) => setLanguage(e.target.value as Lang));
  return (
    <div className={styles.wrap}>
      <label htmlFor={id} className="visually-hidden">
        {t('lang.switch')}
      </label>
      <select id={id} className={styles.select} value={lang} {...touch}>
        {LANGS.map((code) => (
          <option key={code} value={code} lang={code} aria-label={t(code === 'ro' ? 'lang.ro' : 'lang.en')}>
            {t(code === 'ro' ? 'lang.code.ro' : 'lang.code.en')}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
    </div>
  );
}
