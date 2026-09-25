import { ChevronRight, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '../../../app/sessionContext';
import { useI18n } from '../../../i18n/context';
import { reviewPrompt } from '../../../lib/clientBookings';
import { useNow } from '../../../lib/useNow';
import { useOptionalClientBookings } from '../bookings/clientBookingsContext';
import { BOOKINGS_PATH } from '../paths';
import { serviceName } from '../shop/serviceGroups';
import styles from './SearchScreen.module.css';

/**
 * Top of Caută (T19d): the most recently finished job whose review can still be left (60 days),
 * "Cum a fost la Atelier X?"; tapping opens that booking with the review form. Gone once the
 * review is sent, and when the client turned review requests off in Cont. Nothing while loading.
 */
export function ReviewPromptCard() {
  const { t, lang } = useI18n();
  const session = useSession();
  const bookings = useOptionalClientBookings();
  const now = useNow();
  if (!bookings || bookings.state.status !== 'ready' || session.profile?.review_requests === false) return null;
  const { data } = bookings.state;
  const b = reviewPrompt(data.bookings, data.reviewWindowDays, now);
  if (!b) return null;

  const car = [b.car_snapshot.make, b.car_snapshot.model].filter(Boolean).join(' ');
  const service = b.service ? serviceName(b.service, lang) : '';
  const detail = [service, car].filter(Boolean).join(' · ');
  const to = `${BOOKINGS_PATH}?${new URLSearchParams({ p: b.id, recenzie: '1' }).toString()}`;

  return (
    <Link to={to} className={`${styles.expiry} ${styles.expiryAmber}`}>
      <Star size={18} className={styles.expiryIcon} aria-hidden="true" />
      <span className={styles.expiryText}>
        <span className={styles.expiryLine}>{b.shop ? t('reviewPrompt.title', { shop: b.shop.name }) : t('cb.review.leave')}</span>
        {detail && <span className={styles.expiryMore}>{t('reviewPrompt.body', { detail })}</span>}
      </span>
      <ChevronRight size={18} className={styles.expiryChevron} aria-hidden="true" />
    </Link>
  );
}
