import { Link } from 'react-router-dom';
import { LangSwitch } from '../../app/LangSwitch';
import { Card } from '../../components/Card';
import { LogoTile } from '../../components/LogoTile';
import { Wordmark } from '../../components/Wordmark';
import { useI18n } from '../../i18n/context';
import { IS_TEST_BUILD, ROLE_SWITCH_ENABLED } from '../../lib/env';
import styles from './Landing.module.css';

/** Temporary public page until T18: logo + "În curând". */
export function Landing() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <LangSwitch />
      </div>
      <main className={styles.center}>
        <div className={styles.brand}>
          <LogoTile size={56} />
          <Wordmark size={34} />
        </div>
        <p className={styles.soon}>{t('landing.soon')}</p>
        <h1 className={styles.tagline}>{t('landing.tagline')}</h1>
        <p className={styles.drivers}>{t('landing.drivers')}</p>

        {ROLE_SWITCH_ENABLED && (
          <Card className={styles.dev}>
            <p className={styles.devTitle}>{t('devRole.label')}</p>
            <p className={styles.devNote}>{t('devRole.note')}</p>
            <div className={styles.devLinks}>
              <Link to="/?rol=client">{t('devRole.client')}</Link>
              <Link to="/?rol=service">{t('devRole.shop')}</Link>
              <Link to="/?rol=admin">{t('devRole.admin')}</Link>
              {IS_TEST_BUILD && <Link to="/dev/componente">{t('devRole.components')}</Link>}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
