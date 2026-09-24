import { LogoTile } from '../components/LogoTile';
import { Spinner } from '../components/Spinner';
import { useI18n } from '../i18n/context';
import styles from './LoadingScreen.module.css';

/** While the stored session and the profile are read (a moment on start). */
export function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.screen} role="status" aria-busy="true">
      <LogoTile size={48} />
      <Spinner />
      <span className="visually-hidden">{t('common.loading')}</span>
    </div>
  );
}
