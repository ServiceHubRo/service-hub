import { BellRing, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchCars } from '../../../data/garage';
import { useI18n } from '../../../i18n/context';
import type { MessageKey } from '../../../i18n/ro';
import { plural } from '../../../i18n/translate';
import { expiryAlerts } from '../../../lib/expiry';
import { useLoad } from '../../../lib/useLoad';
import { GARAGE_PATH } from '../paths';
import styles from './SearchScreen.module.css';

/**
 * Top of Caută (FR §3.1, P7): the most urgent ITP / RCA / vignette date within 30 days or past,
 * "+N de verificat" when there are more; tapping opens the garage. Nothing while loading or when
 * the garage could not be read — the search itself matters more.
 */
export function ExpiryBanner() {
  const { t, lang } = useI18n();
  const { state } = useLoad(fetchCars);
  if (state.status !== 'ready') return null;
  const alerts = expiryAlerts(state.data);
  const first = alerts[0];
  if (!first) return null;

  const params = { doc: t(`doc.${first.doc}` as MessageKey), car: first.carName };
  const text =
    first.days < 0
      ? t('expiry.ago', { ...params, days: plural(lang, 'unit.days', -first.days) })
      : first.days === 0
        ? t('expiry.today', params)
        : t('expiry.inDays', { ...params, days: plural(lang, 'unit.days', first.days) });

  return (
    <Link to={GARAGE_PATH} className={`${styles.expiry} ${first.urgency === 'expired' ? styles.expiryRed : styles.expiryAmber}`}>
      <BellRing size={18} className={styles.expiryIcon} aria-hidden="true" />
      <span className={styles.expiryText}>
        <span className={styles.expiryLine}>{text}</span>
        {alerts.length > 1 && <span className={styles.expiryMore}>{t('expiry.more', { n: alerts.length - 1 })}</span>}
      </span>
      <ChevronRight size={18} className={styles.expiryChevron} aria-hidden="true" />
    </Link>
  );
}
