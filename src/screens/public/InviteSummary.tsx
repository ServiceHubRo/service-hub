import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import type { InvitePreview } from '../../data/claim';
import { useI18n } from '../../i18n/context';
import { formatDate } from '../../i18n/format';
import { bookingServiceNames } from '../../lib/bookingServices';
import styles from './BookingLink.module.css';

/** What a booking the shop added is about (T29): shop, day and time, services, car, status. */
export function InviteSummary({ preview: p }: { preview: InvitePreview }) {
  const { t, lang } = useI18n();
  const services = bookingServiceNames(lang, null, p.services, '').join(', ');
  const car = [p.car.make, p.car.model].filter(Boolean).join(' ');
  return (
    <Card className={styles.card}>
      <p className={styles.shop}>{t('lk.at', { shop: p.shop_name, city: p.shop_city })}</p>
      <dl className={styles.rows}>
        <dt>{t('lk.row.when')}</dt>
        <dd className="mono">
          {formatDate(lang, p.date)}, {p.slot}
        </dd>
        {services && (
          <>
            <dt>{t('lk.row.services')}</dt>
            <dd>{services}</dd>
          </>
        )}
        {car && (
          <>
            <dt>{t('lk.row.car')}</dt>
            <dd>{car}</dd>
          </>
        )}
        <dt>{t('lk.row.status')}</dt>
        <dd>
          <StatusBadge status={p.status} />
        </dd>
      </dl>
    </Card>
  );
}
