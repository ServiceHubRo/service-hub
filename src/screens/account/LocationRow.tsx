import { MapPin } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useI18n } from '../../i18n/context';
import { requestLocation, useLocation } from '../../lib/location';
import styles from './account.module.css';

/**
 * Cont → Locație (P16d): the status and, while the browser can still ask, a button that asks.
 * A location blocked in the browser can only be allowed again from the browser settings.
 */
export function LocationRow() {
  const { t } = useI18n();
  const { status } = useLocation();
  const canAsk = status === 'prompt' || status === 'error' || status === 'unknown';

  return (
    <Card role="group" aria-label={t('location.title')}>
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          <MapPin size={20} aria-hidden="true" />
          <span className={styles.who}>
            <span>{t('location.title')}</span>
            <span className={styles.small}>{t(`location.status.${status}`)}</span>
          </span>
        </span>
        {(canAsk || status === 'locating') && (
          <Button onClick={() => void requestLocation()} disabled={status === 'locating'} aria-busy={status === 'locating'}>
            {status === 'locating' ? t('location.locating') : t('location.enable')}
          </Button>
        )}
      </div>
    </Card>
  );
}
