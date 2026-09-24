import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { useI18n } from '../i18n/context';
import styles from './SessionErrorScreen.module.css';
import { useSession } from './sessionContext';

/** The profile could not be loaded (usually offline): retry or sign out. */
export function SessionErrorScreen() {
  const { t } = useI18n();
  const session = useSession();
  return (
    <div className={styles.screen}>
      <div className={styles.box}>
        <Banner tone="error">{t('session.loadError')}</Banner>
        <Button variant="primary" block onClick={() => void session.refreshProfile()}>
          {t('action.retry')}
        </Button>
        <Button variant="ghost" block onClick={() => void session.signOut()}>
          {t('nav.logout')}
        </Button>
      </div>
    </div>
  );
}
