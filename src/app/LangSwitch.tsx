import { useI18n } from '../i18n/context';
import { useSession } from './sessionContext';
import type { Lang } from '../i18n/translate';
import styles from './LangSwitch.module.css';

const LANGS: Lang[] = ['ro', 'en'];

export function LangSwitch() {
  const { lang, t } = useI18n();
  // Also saved on the profile when signed in (ARCHITECTURE §15).
  const { setLanguage } = useSession();
  return (
    <div className={styles.switch} role="group" aria-label={t('lang.switch')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          className={`${styles.option} ${code === lang ? styles.on : ''}`}
          aria-pressed={code === lang}
          aria-label={t(code === 'ro' ? 'lang.ro' : 'lang.en')}
          onClick={() => setLanguage(code)}
        >
          {t(code === 'ro' ? 'lang.code.ro' : 'lang.code.en')}
        </button>
      ))}
    </div>
  );
}
