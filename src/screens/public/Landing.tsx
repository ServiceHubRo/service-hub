import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { LoadingScreen } from '../../app/LoadingScreen';
import { homeOf } from '../../app/roles';
import { useSession } from '../../app/sessionContext';
import { Banner } from '../../components/Banner';
import { buttonClass } from '../../components/buttonClass';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { takeAuthLinkError } from '../../data/supabase';
import { useI18n } from '../../i18n/context';
import { IS_TEST_BUILD } from '../../lib/env';
import { LEGAL_DOCS } from '../../lib/legal';
import styles from './Landing.module.css';

/** Public page until T18: logo, "În curând", and the way in. Signed-in users go to their home. */
export function Landing() {
  const { t } = useI18n();
  const session = useSession();
  const location = useLocation();
  const state = location.state as { accountDeleted?: boolean; leaving?: boolean } | null;
  const accountDeleted = state?.accountDeleted;
  const [linkError] = useState(takeAuthLinkError);

  if (session.status === 'loading') return <LoadingScreen />;
  // Just logged out (the session ends a moment after we arrive): stay here.
  if (session.status === 'signedIn' && session.role && !state?.leaving) {
    return <Navigate to={homeOf(session.role)} replace />;
  }
  // An expired or used email link lands here: explain it on the sign-in screen.
  if (linkError && session.status === 'signedOut' && !accountDeleted) {
    return <Navigate to="/intra" replace state={{ linkError: true }} />;
  }

  return (
    <div className={styles.page}>
      <div className="status-backdrop" aria-hidden="true" />
      <div className={styles.top}>
        <LangSwitch />
      </div>
      <main className={styles.center}>
        {accountDeleted && <Banner>{t('account.deleted')}</Banner>}
        <div className={styles.brand}>
          <LogoTile size={56} />
          <Wordmark size={34} />
        </div>
        <p className={styles.soon}>{t('landing.soon')}</p>
        <h1 className={styles.tagline}>{t('landing.tagline')}</h1>
        <p className={styles.drivers}>{t('landing.drivers')}</p>
        <div className={styles.actions}>
          <Link to="/intra" className={buttonClass('primary', true)}>
            {t('auth.signIn')}
          </Link>
          <Link to="/cont-nou" className={buttonClass('secondary', true)}>
            {t('auth.createAccount')}
          </Link>
        </div>
        <nav className={styles.legal} aria-label={t('account.legal')}>
          {LEGAL_DOCS.map((doc) => (
            <Link key={doc.id} to={`/legal/${doc.id}`}>
              {t(doc.titleKey)}
            </Link>
          ))}
          {IS_TEST_BUILD && <Link to="/dev/componente">{t('landing.components')}</Link>}
        </nav>
      </main>
    </div>
  );
}
