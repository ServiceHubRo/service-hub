import { Check } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { buttonClass } from '../../../components/buttonClass';
import { Card } from '../../../components/Card';
import { useI18n } from '../../../i18n/context';
import { formatDate } from '../../../i18n/format';
import { BOOKINGS_PATH, SEARCH_PATH } from '../paths';
import { SERVICE_SEPARATOR } from '../../../lib/bookingServices';
import { serviceName } from '../shop/serviceGroups';
import styles from './booking.module.css';

/** What the flow hands to the success screen (router state; gone after a reload). */
export interface SentState {
  ref: string;
  shopName: string;
  services: { name_ro: string; name_en: string }[];
  date: string;
  time: string;
  car: string;
  /** The new-client offer the booking got (T23). */
  offer?: number | null;
}

/** After "Trimite cererea" (P6): a green check, what happens next, one way on. */
export function BookingSent() {
  const { t, lang } = useI18n();
  const state = useLocation().state as SentState | null;
  // A state from before T21 (one service) has no list: the summary then leaves the services out.
  const sent = state && Array.isArray(state.services) ? state : null;
  return (
    <div className={`${styles.page} ${styles.sent}`}>
      <span className={styles.sentIcon} aria-hidden="true">
        <Check size={34} strokeWidth={3} />
      </span>
      <h1 className={styles.sentTitle}>{t('booking.sent.title')}</h1>
      <p className={styles.sentBody}>{t('booking.sent.body')}</p>
      {sent && (
        <Card className={styles.summary}>
          <SummaryRow label={t('booking.summary.shop')} value={sent.shopName} />
          <SummaryRow
            label={t(sent.services.length > 1 ? 'booking.summary.services' : 'booking.summary.service')}
            value={sent.services.map((x) => serviceName(x, lang)).join(SERVICE_SEPARATOR)}
          />
          <SummaryRow label={t('booking.summary.when')} value={`${formatDate(lang, sent.date)}, ${sent.time}`} mono />
          {sent.car && <SummaryRow label={t('booking.summary.car')} value={sent.car} />}
          {sent.offer ? <SummaryRow label={t('offer.summary')} value={t('offer.short', { n: sent.offer })} /> : null}
          <SummaryRow label={t('booking.sent.ref')} value={sent.ref} mono />
        </Card>
      )}
      <div className={styles.sentActions}>
        <Link to={BOOKINGS_PATH} className={buttonClass('primary', true)}>
          {t('booking.sent.toBookings')}
        </Link>
        <Link to={SEARCH_PATH} className={buttonClass('secondary', true)}>
          {t('booking.sent.toSearch')}
        </Link>
      </div>
    </div>
  );
}

/** One "label … value" line of a booking summary (step 4 and this screen). */
export function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.summaryRow}>
      <span className={styles.muted}>{label}</span>
      <span className={`${styles.summaryValue} ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}
