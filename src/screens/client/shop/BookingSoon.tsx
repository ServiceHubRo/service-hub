import { CalendarClock } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { BackLink } from '../../../components/BackLink';
import { EmptyState } from '../../../components/EmptyState';
import { useI18n } from '../../../i18n/context';
import { shopPath } from '../paths';
import styles from './ShopPage.module.css';

/** Where "Programează-te" leads until the 4-step booking flow arrives (T07 replaces this screen). */
export function BookingSoon() {
  const { t } = useI18n();
  const { shopId = '' } = useParams();
  return (
    <div className={styles.page}>
      <BackLink to={shopPath(shopId)} label={t('booking.backToShop')} />
      <h1>{t('booking.title')}</h1>
      <EmptyState icon={CalendarClock} title={t('booking.soon')} body={t('booking.soonBody')} />
    </div>
  );
}
