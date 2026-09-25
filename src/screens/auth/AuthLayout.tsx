import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import styles from './AuthLayout.module.css';

/** Signed-out screens: fills the viewport, content centered, scrolls on small phones (P4b). */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <div className="status-backdrop" aria-hidden="true" />
      <div className={styles.top}>
        <LangSwitch />
      </div>
      <main className={styles.center}>
        <Link to="/" className={styles.brand} aria-label={t('app.title')}>
          <LogoTile size={52} />
          <Wordmark size={30} />
        </Link>
        <p className={styles.tagline}>{t('auth.tagline')}</p>
        <div className={styles.body}>{children}</div>
      </main>
    </div>
  );
}
