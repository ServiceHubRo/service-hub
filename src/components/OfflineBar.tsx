import { WifiOff } from 'lucide-react';
import { useI18n } from '../i18n/context';
import { useOnline } from '../lib/useOnline';
import styles from './OfflineBar.module.css';

/** Slim bar at the top while the browser is offline. Does not block the interface. */
export function OfflineBar() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div className={styles.bar} role="status">
      <WifiOff size={14} aria-hidden="true" />
      {t('offline.bar')}
    </div>
  );
}
