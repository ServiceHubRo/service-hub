import { BellRing, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchCars } from '../../../data/garage';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { expiryAlerts, type ExpiryAlert } from '../../../lib/expiry';
import { useLoad } from '../../../lib/useLoad';
import { GARAGE_PATH } from '../paths';
import styles from './SearchScreen.module.css';

/** Lines shown in the card; more than this ends with "+N în Garaj". */
const MAX_LINES = 3;

/**
 * Top of Caută (FR §3.1, P7): every ITP / RCA / vignette date within 30 days or past, one line
 * each, most urgent first (at most MAX_LINES, then "+N în Garaj"); tapping opens the garage.
 * Nothing while loading or when the garage could not be read — the search itself matters more.
 */
export function ExpiryBanner() {
  const { t, lang } = useI18n();
  const { state } = useLoad(fetchCars);
  if (state.status !== 'ready') return null;
  const alerts = expiryAlerts(state.data);
  const first = alerts[0];
  if (!first) return null;

  const lineText = (alert: ExpiryAlert) => {
    const params = { doc: t(`doc.${alert.doc}` as MessageKey), car: alert.carName };
    if (alert.days < 0) return t('expiry.ago', { ...params, days: plural(lang, 'unit.days', -alert.days) });
    if (alert.days === 0) return t('expiry.today', params);
    return t('expiry.inDays', { ...params, days: plural(lang, 'unit.days', alert.days) });
  };
  const shown = alerts.slice(0, MAX_LINES);
  const hidden = alerts.length - shown.length;

  return (
    <Link to={GARAGE_PATH} className={`${styles.expiry} ${first.urgency === 'expired' ? styles.expiryRed : styles.expiryAmber}`}>
      <BellRing size={18} className={styles.expiryIcon} aria-hidden="true" />
      <span className={styles.expiryText}>
        {shown.map((alert) => (
          <span key={`${alert.carId}-${alert.doc}`} className={`${styles.expiryLine} ${alert.urgency === 'expired' ? styles.expiryLineRed : ''}`}>
            {lineText(alert)}
          </span>
        ))}
        {hidden > 0 && <span className={styles.expiryMore}>{t('expiry.more', { n: hidden })}</span>}
      </span>
      <ChevronRight size={18} className={styles.expiryChevron} aria-hidden="true" />
    </Link>
  );
}
